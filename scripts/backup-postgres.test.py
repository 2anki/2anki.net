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
        self.stub('pg_dump', 'for a in "$@"; do case "$a" in --file=*) echo plain-rows > "${a#--file=}";; esac; done')
        self.stub('pg_restore', 'echo "1; 0 0 TABLE DATA public users owner"')
        self.stub('gpg', 'while [ $# -gt 0 ]; do if [ "$1" = --output ]; then o="$2"; fi; shift; done; echo ciphertext > "$o"')
        self.stub('aws', 'if [ "$1" = s3api ]; then echo 11; fi')
        self.stub('sendmail', f'cat >> {self.mail}')
        self.stub('date', 'case "$*" in *%a*) echo Mon;; *%d*) echo "${FAKE_DAY:-15}";; *%Y-%m*|*%m*) echo 2026-11;; *) echo now;; esac')

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
        self.assertNotIn('monthly-', calls)
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

    def test_output_holds_no_credentials(self):
        result = self.run_backup()
        for secret in SECRETS:
            self.assertNotIn(secret, result.stdout + result.stderr)

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
