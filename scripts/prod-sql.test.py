"""Tests for scripts/prod-sql.sh. Run: python3 scripts/prod-sql.test.py

A fake ssh runs the remote command locally, the way sshd hands it to the login
shell, and a fake psql records what it was given, so nothing touches the network.
"""

import os
import stat
import subprocess
import tempfile
import unittest

SCRIPT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "prod-sql.sh")

DATABASE_URL = "postgres://app_user:s3cretPassw0rd@db.internal.example.com:5432/app"
MULTI_LINE_VALUE = "first-line-of-a-fake-key\nsecond-line-of-a-fake-key"

FAKE_SSH = """#!/bin/bash
printf '%s\\n' "$@" > "$FAKE_DIR/ssh-args"
while [ "$#" -gt 0 ]; do
  case "$1" in
    -o) shift 2 ;;
    -*) shift ;;
    *) break ;;
  esac
done
printf '%s' "$1" > "$FAKE_DIR/ssh-host"
shift
exec bash -c "$*"
"""

FAKE_PSQL = """#!/bin/bash
printf '%s\\n' "$@" > "$FAKE_DIR/psql-args"
printf '%s' "${PGOPTIONS-}" > "$FAKE_DIR/pgoptions"
cat > "$FAKE_DIR/psql-stdin"
echo " count"
echo "    42"
"""


def executable(path, body):
    with open(path, "w") as f:
        f.write(body)
    os.chmod(path, os.stat(path).st_mode | stat.S_IEXEC)


class Run:
    def __init__(self, sql, env_file=None, raw_args=None):
        self.root = tempfile.TemporaryDirectory()
        root = self.root.name
        bin_dir = os.path.join(root, "bin")
        home = os.path.join(root, "home")
        os.makedirs(bin_dir)
        os.makedirs(os.path.join(home, "src/github.com/2anki/2anki.net"))
        executable(os.path.join(bin_dir, "ssh"), FAKE_SSH)
        executable(os.path.join(bin_dir, "psql"), FAKE_PSQL)
        if env_file is not None:
            with open(os.path.join(home, "src/github.com/2anki/2anki.net/.env"), "w") as f:
                f.write(env_file)
        sql_path = os.path.join(root, "query.sql")
        if sql is not None:
            with open(sql_path, "w") as f:
                f.write(sql)
        args = [sql_path] if raw_args is None else raw_args
        self.result = subprocess.run(
            ["bash", SCRIPT, *args],
            capture_output=True,
            text=True,
            stdin=subprocess.DEVNULL,
            env={**os.environ, "HOME": home, "FAKE_DIR": root, "PATH": bin_dir + os.pathsep + os.environ["PATH"]},
        )

    def recorded(self, name):
        path = os.path.join(self.root.name, name)
        if not os.path.exists(path):
            return None
        with open(path) as f:
            return f.read()

    def close(self):
        self.root.cleanup()


def env_with_url():
    return f'NODE_ENV=production\nSIGNING_KEY="{MULTI_LINE_VALUE}"\nDATABASE_URL="{DATABASE_URL}"\nSECRET=other\n'


class ProdSqlTest(unittest.TestCase):
    def run_sql(self, sql, **kwargs):
        run = Run(sql, **kwargs)
        self.addCleanup(run.close)
        return run

    def test_runs_the_file_in_a_read_only_session(self):
        run = self.run_sql("select count(*) from users;\n", env_file=env_with_url())

        self.assertEqual(run.result.returncode, 0, run.result.stderr)
        self.assertEqual(run.result.stdout, " count\n    42\n")
        options = run.recorded("pgoptions")
        self.assertIn("-c default_transaction_read_only=on", options)
        self.assertIn("-c statement_timeout=120000", options)
        self.assertIn("-c lock_timeout=5000", options)

    def test_sends_the_session_settings_ahead_of_the_sql_on_stdin(self):
        run = self.run_sql("select 1;\n", env_file=env_with_url())

        self.assertEqual(
            run.recorded("psql-stdin"),
            "SET default_transaction_read_only = on;\nSET statement_timeout = '120s';\nSET lock_timeout = '5s';\nselect 1;\n",
        )

    def test_psql_stops_on_the_first_error_and_skips_psqlrc(self):
        run = self.run_sql("select 1;\n", env_file=env_with_url())

        self.assertEqual(run.recorded("psql-args").splitlines(), [DATABASE_URL, "-X", "-q", "-v", "ON_ERROR_STOP=1", "-f", "-"])

    def test_connects_to_the_named_host_without_prompting(self):
        run = self.run_sql("select 1;\n", env_file=env_with_url())

        self.assertEqual(run.recorded("ssh-host"), "alemayhu@2anki.net")
        self.assertIn("BatchMode=yes", run.recorded("ssh-args"))
        self.assertNotIn("select 1", run.recorded("ssh-args"))

    def test_never_prints_the_connection_string_or_other_env_values(self):
        run = self.run_sql("select 1;\n", env_file=env_with_url())

        for leaked in ("s3cretPassw0rd", "db.internal.example.com", "fake-key", "SECRET=other"):
            self.assertNotIn(leaked, run.result.stdout + run.result.stderr)

    def test_says_so_when_the_env_file_has_no_database_url(self):
        run = self.run_sql("select 1;\n", env_file=f'SIGNING_KEY="{MULTI_LINE_VALUE}"\n')

        self.assertEqual(run.result.returncode, 6)
        self.assertIn("DATABASE_URL is not set", run.result.stderr)
        self.assertNotIn("fake-key", run.result.stderr)
        self.assertIsNone(run.recorded("psql-args"))

    def test_says_so_when_the_env_file_is_missing(self):
        run = self.run_sql("select 1;\n")

        self.assertEqual(run.result.returncode, 6)
        self.assertIn("not readable", run.result.stderr)

    def test_allows_explain_analyze_and_display_meta_commands(self):
        sql = "\\x on\n\\pset format csv\nexplain analyze select created_at, deleted_at from uploads where status = 'done';\n"
        run = self.run_sql(sql, env_file=env_with_url())

        self.assertEqual(run.result.returncode, 0, run.result.stderr)
        self.assertTrue(run.recorded("psql-stdin").endswith(sql))

    def test_refuses_statements_that_write_or_change_settings(self):
        cases = [
            "insert into users values (1);",
            "update users set name = 'x';",
            "delete from users;",
            "truncate users;",
            "alter table users add column x int;",
            "drop table users;",
            "create table t (id int);",
            "grant select on users to public;",
            "copy (select 1) to program 'id';",
            "select * into backup from users;",
            "set default_transaction_read_only = off;",
            "SET SESSION CHARACTERISTICS AS TRANSACTION READ WRITE;",
            "begin read write;",
            "reset all;",
            "select set_config('default_transaction_read_only', 'off', false);",
            "do $$ begin perform 1; end $$;",
            "select query_to_xml('select 1', true, true, '');",
            "select pg_terminate_backend(42);",
            "analyze users;",
            "\\! id",
            "\\copy users to 'out.csv'",
            "\\o /tmp/out.txt",
            "\\set default_transaction_read_only off",
            "\\gexec",
            "\\echo `id`",
        ]
        for sql in cases:
            with self.subTest(sql=sql):
                run = self.run_sql("select 1;\n" + sql + "\n", env_file=env_with_url())
                self.assertEqual(run.result.returncode, 5)
                self.assertIn("refused:", run.result.stderr)
                self.assertIn("on line 2", run.result.stderr)
                self.assertIsNone(run.recorded("ssh-args"))

    def test_refuses_a_missing_empty_or_oversized_file(self):
        missing = self.run_sql(None)
        empty = self.run_sql("")
        oversized = self.run_sql("select 1;\n" + "-- padding\n" * 7000)

        for run in (missing, empty, oversized):
            with self.subTest(stderr=run.result.stderr):
                self.assertEqual(run.result.returncode, 2)
                self.assertIsNone(run.recorded("ssh-args"))

    def test_refuses_a_directory_or_extra_arguments(self):
        for args in ([], ["/"], ["a.sql", "b.sql"]):
            with self.subTest(args=args):
                run = self.run_sql(None, raw_args=args)
                self.assertEqual(run.result.returncode, 2)
                self.assertIsNone(run.recorded("ssh-args"))


if __name__ == "__main__":
    unittest.main()
