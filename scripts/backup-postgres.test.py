#!/usr/bin/env python3
"""Tests for scripts/backup-postgres.sh, with its external tools stubbed."""
import os
import pathlib
import stat
import subprocess
import tempfile
import unittest

SCRIPT = pathlib.Path(__file__).with_name('backup-postgres.sh')
SECRETS = ('s3cret-db-password', 'SPACESKEY', 'SPACESSECRET')


class BackupScriptTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = pathlib.Path(self.tmp.name)
        self.bin = self.root / 'bin'
        self.bin.mkdir()
        self.calls = self.root / 'calls.log'
        self.mail = self.root / 'mail.log'
        self.env_file = self.root / '.env'
        self.env_file.write_text(
            'DATABASE_URL="postgres://u:s3cret-db-password@localhost:5432/2anki"\n'
            'SPACES_ENDPOINT=https://fra1.example.test\n'
            'SPACES_DEFAULT_BUCKET_NAME=bucket\n'
            'SPACES_REGION=fra1\n'
            'AWS_ACCESS_KEY_ID=SPACESKEY\n'
            "AWS_SECRET_ACCESS_KEY='SPACESSECRET'\n"
        )
        self.key = self.root / 'public.asc'
        self.key.write_text('public key')
        self.work = self.root / 'work'
        self.pg_env = self.root / 'pg.env'
        self.stub('pg_dump', f'echo "$PGUSER|$PGPASSWORD|$PGHOST|$PGPORT|$PGDATABASE" > {self.pg_env}; for a in "$@"; do case "$a" in --file=*) echo plain-rows > "${{a#--file=}}";; esac; done')
        self.stub('pg_restore', 'echo "1; 0 0 TABLE DATA public users owner"')
        self.stub('gpg', 'while [ $# -gt 0 ]; do if [ "$1" = --output ]; then o="$2"; fi; shift; done; echo ciphertext > "$o"')
        self.stub('aws', 'if [ "$1" = s3api ]; then echo 11; fi')
        self.stub('sendmail', f'cat >> {self.mail}')
        self.stub('date', 'case "$*" in *%a*) echo Mon;; *%d*) echo "${FAKE_DAY:-15}";; *%Y-%m*|*%m*) echo "${FAKE_MONTH:-2026-11}";; *) echo now;; esac')

    def tearDown(self):
        self.tmp.cleanup()

    def stub(self, name, body):
        path = self.bin / name
        path.write_text(f'#!/bin/bash\necho "{name} $*" >> {self.calls}\n{body}\n')
        path.chmod(path.stat().st_mode | stat.S_IEXEC)

    def run_backup(self, **extra):
        env = {
            'PATH': f'{self.bin}:/usr/bin:/bin',
            'HOME': str(self.root),
            'BACKUP_ENV_FILE': str(self.env_file),
            'BACKUP_PUBLIC_KEY': str(self.key),
            'BACKUP_WORK_ROOT': str(self.work),
            'BACKUP_ALERT_EMAIL': 'ops@example.test',
            **extra,
        }
        return subprocess.run(['bash', str(SCRIPT)], env=env, capture_output=True, text=True)

    def leftovers(self):
        return list(self.work.iterdir()) if self.work.exists() else []

    def calls_text(self):
        return self.calls.read_text() if self.calls.exists() else ''

    def test_uploads_the_encrypted_dump_for_the_weekday(self):
        result = self.run_backup()
        self.assertEqual(result.returncode, 0, result.stderr)
        calls = self.calls_text()
        self.assertIn('s3://bucket/backups/postgres/daily-Mon.dump.gpg', calls)
        self.assertLess(calls.index('gpg '), calls.index('aws s3 cp'))
        self.assertNotIn('monthly-2026-11.dump.gpg', calls)
        self.assertFalse(self.mail.exists())

    def test_never_uploads_the_unencrypted_dump(self):
        self.run_backup()
        upload = next(l for l in self.calls_text().splitlines() if l.startswith('aws s3 cp'))
        self.assertIn('dump.gpg s3://', upload)

    def test_also_keeps_a_monthly_copy_on_the_first(self):
        self.run_backup(FAKE_DAY='01')
        self.assertIn('backups/postgres/monthly-2026-11.dump.gpg', self.calls_text())

    def test_removes_its_working_files(self):
        self.run_backup()
        self.assertEqual(self.leftovers(), [])

    def test_keeps_the_password_out_of_process_arguments(self):
        self.run_backup()
        self.assertNotIn('s3cret-db-password', self.calls_text())
        self.assertEqual(
            self.pg_env.read_text().strip(),
            'u|s3cret-db-password|localhost|5432|2anki',
        )

    def test_decodes_a_password_with_escaped_characters(self):
        self.env_file.write_text(
            self.env_file.read_text().replace('s3cret-db-password', 'p%40ss')
        )
        self.run_backup()
        self.assertIn('|p@ss|', self.pg_env.read_text())

    def test_a_long_listing_after_the_users_table_does_not_fail_the_backup(self):
        self.stub(
            'pg_restore',
            'echo "1; 0 0 TABLE DATA public users owner"; seq 1 200000',
        )
        result = self.run_backup()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertFalse(self.mail.exists())

    def test_reads_the_alert_address_from_the_env_file(self):
        with self.env_file.open('a') as handle:
            handle.write('BACKUP_ALERT_EMAIL=ops@example.test\n')
        self.stub('pg_dump', 'exit 3')
        result = self.run_backup(BACKUP_ALERT_EMAIL='')
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('To: ops@example.test', self.mail.read_text())

    def test_uses_the_last_value_of_a_repeated_setting_like_the_app(self):
        with self.env_file.open('a') as handle:
            handle.write('SPACES_DEFAULT_BUCKET_NAME=newer\n')
        self.run_backup()
        self.assertIn('s3://newer/', self.calls_text())

    def test_removes_a_plain_dump_left_by_a_killed_run(self):
        stale = self.work / 'run.killed'
        stale.mkdir(parents=True)
        (stale / 'dump').write_text('plain-rows')
        self.run_backup()
        self.assertFalse(stale.exists())

    def test_stops_and_alerts_on_a_missing_database_url(self):
        self.env_file.write_text('SPACES_ENDPOINT=https://x\n')
        self.assert_alerted(self.run_backup(), 'reading configuration')
        self.assertNotIn('pg_dump', self.calls_text())

    def test_alerts_when_the_monthly_upload_fails(self):
        self.stub('aws', 'case "$*" in *monthly*) exit 1;; esac; if [ "$1" = s3api ]; then echo 11; fi')
        self.assert_alerted(self.run_backup(FAKE_DAY='01'), 'uploading monthly-2026-11')

    def test_output_holds_no_credentials(self):
        result = self.run_backup()
        for secret in SECRETS:
            self.assertNotIn(secret, result.stdout + result.stderr)

    def stub_monthly_listing(self, keys):
        listing = '\\t'.join(keys) if keys else 'None'
        self.stub(
            'aws',
            'case "$2" in list-objects-v2) printf "%b\\n" "' + listing + '";; '
            'head-object) echo 11;; esac',
        )

    def removed_keys(self):
        return [
            l.split('s3://bucket/')[1]
            for l in self.calls_text().splitlines()
            if l.startswith('aws s3 rm')
        ]

    def test_keeps_the_three_newest_monthly_dumps_and_removes_older_ones(self):
        self.stub_monthly_listing([
            f'backups/postgres/monthly-2026-{m:02d}.dump.gpg' for m in range(7, 12)
        ])
        result = self.run_backup()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(
            self.removed_keys(),
            [
                'backups/postgres/monthly-2026-07.dump.gpg',
                'backups/postgres/monthly-2026-08.dump.gpg',
            ],
        )

    def test_counts_kept_months_across_a_new_year(self):
        self.stub_monthly_listing([
            'backups/postgres/monthly-2026-10.dump.gpg',
            'backups/postgres/monthly-2026-11.dump.gpg',
            'backups/postgres/monthly-2026-12.dump.gpg',
            'backups/postgres/monthly-2027-01.dump.gpg',
        ])
        self.run_backup(FAKE_MONTH='2027-01')
        self.assertEqual(
            self.removed_keys(), ['backups/postgres/monthly-2026-10.dump.gpg']
        )

    def test_removes_nothing_when_no_monthly_dump_is_old_enough(self):
        self.stub_monthly_listing(['backups/postgres/monthly-2026-11.dump.gpg'])
        result = self.run_backup()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(self.removed_keys(), [])

    def test_removes_nothing_when_there_are_no_monthly_dumps(self):
        self.stub_monthly_listing([])
        result = self.run_backup()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(self.removed_keys(), [])

    def test_leaves_keys_that_are_not_monthly_dumps_alone(self):
        self.stub_monthly_listing([
            'backups/postgres/monthly-notes.txt',
            'backups/postgres/monthly-2020-01.dump.gpg.partial',
        ])
        self.run_backup()
        self.assertEqual(self.removed_keys(), [])

    def test_lists_only_the_monthly_prefix(self):
        self.stub_monthly_listing([])
        self.run_backup()
        listing = next(
            l for l in self.calls_text().splitlines() if 'list-objects-v2' in l
        )
        self.assertIn('--prefix backups/postgres/monthly-', listing)

    def test_alerts_when_the_monthly_listing_fails(self):
        self.stub('aws', 'case "$2" in list-objects-v2) exit 1;; head-object) echo 11;; esac')
        self.assert_alerted(self.run_backup(), 'removing monthly dumps')

    def assert_alerted(self, result, stage):
        self.assertNotEqual(result.returncode, 0)
        mail = self.mail.read_text()
        self.assertIn('To: ops@example.test', mail)
        self.assertIn(stage, mail)
        for secret in SECRETS:
            self.assertNotIn(secret, mail)
        self.assertEqual(self.leftovers(), [])

    def test_alerts_when_the_dump_fails(self):
        self.stub('pg_dump', 'exit 3')
        self.assert_alerted(self.run_backup(), 'dumping the database')

    def test_alerts_and_does_not_upload_when_the_dump_cannot_be_read(self):
        self.stub('pg_restore', 'echo nothing useful')
        self.assert_alerted(self.run_backup(), 'checking the dump can be read')
        self.assertNotIn('aws s3 cp', self.calls_text())

    def test_alerts_and_does_not_upload_when_encryption_fails(self):
        self.stub('gpg', 'exit 2')
        self.assert_alerted(self.run_backup(), 'encrypting the dump')
        self.assertNotIn('aws s3 cp', self.calls_text())

    def test_alerts_when_the_upload_fails(self):
        self.stub('aws', 'exit 1')
        self.assert_alerted(self.run_backup(), 'uploading daily-Mon')

    def test_alerts_when_the_uploaded_size_differs(self):
        self.stub('aws', 'if [ "$1" = s3api ]; then echo 3; fi')
        self.assert_alerted(self.run_backup(), 'confirming daily-Mon')

    def test_refuses_to_run_without_an_alert_address(self):
        result = self.run_backup(BACKUP_ALERT_EMAIL='')
        self.assertNotEqual(result.returncode, 0)
        self.assertNotIn('pg_dump', self.calls_text())

    def test_refuses_to_run_without_the_public_key(self):
        self.key.unlink()
        self.assert_alerted(self.run_backup(), 'reading configuration')
        self.assertNotIn('pg_dump', self.calls_text())


if __name__ == '__main__':
    unittest.main()
