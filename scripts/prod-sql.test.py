"""Tests for scripts/prod-sql.sh. Run: python3 scripts/prod-sql.test.py

A fake ssh runs the remote command locally, the way sshd hands it to the login
shell; a fake timeout and psql record what they were given. Nothing touches the
network.
"""

import os
import stat
import subprocess
import tempfile
import unittest

SCRIPT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "prod-sql.sh")

URL_SECRET = "fakeSecret%2FValue0"
DECODED_URL_SECRET = "fakeSecret/Value0"
APP_URL = f"postgres://app_user:{URL_SECRET}@db.internal.example.com:5432/app?sslmode=require&options=-c%20x%3Dy"
READER_URL = "postgres://reader:fakeReaderValue1@db.internal.example.com/app"
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

FAKE_TIMEOUT = """#!/bin/bash
printf '%s\\n' "$@" > "$FAKE_DIR/timeout-args"
while [ "$#" -gt 0 ] && [ "$1" != psql ]; do shift; done
exec "$@"
"""

FAKE_PSQL = """#!/bin/bash
printf '%s\\n' "$@" > "$FAKE_DIR/psql-args"
env | grep '^PG' | sort > "$FAKE_DIR/psql-env"
cat > "$FAKE_DIR/psql-stdin"
echo " count"
echo "    42"
"""

PREAMBLE = (
    "SET statement_timeout = '120s';\n"
    "SET lock_timeout = '5s';\n"
    "SET idle_in_transaction_session_timeout = '60s';\n"
    "SET default_transaction_read_only = on;\n"
    "BEGIN TRANSACTION READ ONLY;\n"
)
EPILOGUE = "\n;\nROLLBACK;\n"


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
        executable(os.path.join(bin_dir, "timeout"), FAKE_TIMEOUT)
        executable(os.path.join(bin_dir, "psql"), FAKE_PSQL)
        if env_file is not None:
            with open(os.path.join(home, "src/github.com/2anki/2anki.net/.env"), "w") as f:
                f.write(env_file)
        sql_path = os.path.join(root, "query.sql")
        if sql is not None:
            with open(sql_path, "wb") as f:
                f.write(sql if isinstance(sql, bytes) else sql.encode())
        args = [sql_path] if raw_args is None else raw_args
        environment = {k: v for k, v in os.environ.items() if not k.startswith("PG")}
        self.result = subprocess.run(
            ["bash", SCRIPT, *args],
            capture_output=True,
            text=True,
            stdin=subprocess.DEVNULL,
            env={**environment, "HOME": home, "FAKE_DIR": root, "PATH": bin_dir + os.pathsep + os.environ["PATH"]},
        )

    def recorded(self, name):
        path = os.path.join(self.root.name, name)
        if not os.path.exists(path):
            return None
        with open(path) as f:
            return f.read()

    def psql_env(self):
        lines = (self.recorded("psql-env") or "").splitlines()
        return dict(line.split("=", 1) for line in lines)

    def close(self):
        self.root.cleanup()


def app_env(extra=""):
    return f'NODE_ENV=production\nSIGNING_KEY="{MULTI_LINE_VALUE}"\nDATABASE_URL="{APP_URL}"\n{extra}SECRET=other\n'


class Case(unittest.TestCase):
    def run_sql(self, sql, **kwargs):
        run = Run(sql, **kwargs)
        self.addCleanup(run.close)
        return run

    def assert_refused(self, sql):
        run = self.run_sql(sql, env_file=app_env())
        self.assertEqual(run.result.returncode, 5, run.result.stderr)
        self.assertIn("refused:", run.result.stderr)
        self.assertIsNone(run.recorded("ssh-args"))
        return run


class SessionTest(Case):
    def test_runs_the_file_inside_one_read_only_transaction(self):
        run = self.run_sql("select count(*) from users;\n", env_file=app_env())

        self.assertEqual(run.result.returncode, 0, run.result.stderr)
        self.assertEqual(run.result.stdout, " count\n    42\n")
        self.assertEqual(run.recorded("psql-stdin"), PREAMBLE + "select count(*) from users;\n" + EPILOGUE)

    def test_a_last_statement_without_a_semicolon_is_still_closed_before_the_rollback(self):
        run = self.run_sql("select 1", env_file=app_env())

        self.assertEqual(run.recorded("psql-stdin"), PREAMBLE + "select 1" + EPILOGUE)

    def test_sets_read_only_and_timeouts_in_pgoptions(self):
        run = self.run_sql("select 1;\n", env_file=app_env())

        options = run.psql_env()["PGOPTIONS"]
        self.assertIn("-c default_transaction_read_only=on", options)
        self.assertIn("-c statement_timeout=120000", options)
        self.assertIn("-c lock_timeout=5000", options)

    def test_caps_the_whole_run_with_a_wall_clock_timeout(self):
        run = self.run_sql("select 1;\n", env_file=app_env())

        self.assertEqual(run.recorded("timeout-args").splitlines()[:4], ["-k", "10s", "300s", "psql"])

    def test_psql_gets_no_url_and_no_secret_on_its_command_line(self):
        run = self.run_sql("select 1;\n", env_file=app_env())

        args = run.recorded("psql-args")
        self.assertEqual(args.splitlines(), ["-X", "-q", "-v", "ON_ERROR_STOP=1", "-f", "-"])
        for leaked in (URL_SECRET, DECODED_URL_SECRET, "postgres://", "db.internal"):
            self.assertNotIn(leaked, args)
            self.assertNotIn(leaked, run.recorded("timeout-args"))
            self.assertNotIn(leaked, run.recorded("ssh-args"))

    def test_parses_the_connection_string_into_libpq_variables(self):
        env = self.run_sql("select 1;\n", env_file=app_env()).psql_env()

        self.assertEqual(env["PGHOST"], "db.internal.example.com")
        self.assertEqual(env["PGPORT"], "5432")
        self.assertEqual(env["PGUSER"], "app_user")
        self.assertEqual(env["PGPASSWORD"], DECODED_URL_SECRET)
        self.assertEqual(env["PGDATABASE"], "app")
        self.assertEqual(env["PGSSLMODE"], "require")
        self.assertNotIn("x=y", env["PGOPTIONS"])

    def test_prefers_the_read_only_role_when_its_variable_is_set(self):
        env = self.run_sql("select 1;\n", env_file=app_env(f'READONLY_DATABASE_URL="{READER_URL}"\n')).psql_env()

        self.assertEqual(env["PGUSER"], "reader")
        self.assertEqual(env["PGPASSWORD"], "fakeReaderValue1")
        self.assertNotIn("PGPORT", env)

    def test_never_prints_the_connection_details_or_other_env_values(self):
        run = self.run_sql("select 1;\n", env_file=app_env())

        for leaked in ("fakeSecret", "db.internal.example.com", "fake-key", "SECRET=other", "app_user"):
            self.assertNotIn(leaked, run.result.stdout + run.result.stderr)

    def test_connects_to_the_named_host_without_prompting(self):
        run = self.run_sql("select 1;\n", env_file=app_env())

        self.assertEqual(run.recorded("ssh-host"), "alemayhu@2anki.net")
        self.assertIn("BatchMode=yes", run.recorded("ssh-args"))
        self.assertNotIn("select 1", run.recorded("ssh-args"))

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


class AcceptedTest(Case):
    def test_accepts_plain_read_statements(self):
        for sql in (
            "select count(*) from users where created_at > now() - interval '7 days';",
            "with recent as (select id from uploads) select count(*) from recent;",
            "explain select 1;",
            "explain (format json) select 1;",
            "show statement_timeout;",
            "table knex_migrations;",
            "select 'café; with a semicolon' as label, pg_size_pretty(pg_total_relation_size('users'));",
            'select "Weird Column", x::text from t where name = \'e\' and kind = \'it\'\'s\';',
            "select case when a then 1 else 2 end from t;\nselect 2;\n",
            "select deleted_at, updated_at, created_at from uploads order by 1 desc limit 5;",
        ):
            with self.subTest(sql=sql):
                run = self.run_sql(sql, env_file=app_env())
                self.assertEqual(run.result.returncode, 0, run.result.stderr)


class RefusedTest(Case):
    def test_refuses_each_reviewed_probe_before_anything_is_sent(self):
        for sql in (
            "select 1;\nbegin transaction read /* x */ write;\n",
            "start transaction read -- x\nwrite;\n",
            "do E'\\x62egin perform 1; end';\n",
            "do /* x */ $$ begin perform 1; end $$;\n",
            'select U&"\\0070g_sleep"(1);\n',
            "select set_config('default_transaction_read_only', 'off', false);\n",
            "select pg_terminate_backend(42);\n",
            "with x as (insert into t values (1) returning *) select * from x;\n",
            "with x as (delete from t returning *) select * from x;\n",
            "select * into newtable from users;\n",
            "explain analyze insert into t values (1);\n",
            "copy (select 1) to program 'id';\n",
            "select 'it''s'; delete from t; select '';\n",
            "select 'a\\'; delete from t; select 1;\n",
            "\\gexec\n",
            "\\! id\n",
        ):
            with self.subTest(sql=sql):
                self.assert_refused(sql)

    def test_refuses_a_byte_order_mark_and_a_nul(self):
        for sql in (b"\xef\xbb\xbfselect 1;\n", b"select 1;\x00\n"):
            with self.subTest(sql=sql):
                self.assert_refused(sql)

    def test_refuses_statements_outside_the_allowlist(self):
        for sql in (
            "values (1);",
            "set statement_timeout = 0;",
            "reset all;",
            "commit;",
            "rollback;",
            "end;",
            "abort;",
            "begin;",
            "select 1; start transaction;",
            "(select 1);",
            "listen x;",
            "vacuum users;",
        ):
            with self.subTest(sql=sql):
                self.assert_refused(sql)

    def test_refuses_calls_that_change_state_or_reach_outside(self):
        for sql in (
            "select pg_cancel_backend(1);",
            "select pg_advisory_lock(1);",
            "select pg_try_advisory_lock(1);",
            "select nextval('s');",
            "select setval('s', 1);",
            "select lo_import('/etc/hosts');",
            "select lo_export(1, '/tmp/x');",
            "select pg_read_file('/etc/hosts');",
            "select pg_read_binary_file('/etc/hosts');",
            "select pg_ls_dir('.');",
            "select dblink('x', 'y');",
            "select pg_sleep(1);",
            "select pg_catalog.pg_sleep (1);",
            "select pg_reload_conf();",
            "select pg_notify('c', 'x');",
            "select query_to_xml('select 1', true, true, '');",
            "select cron.schedule('a', 'b');",
            'select "pg_sleep"(1);',
            'select pg_catalog."pg_sleep" (1);',
        ):
            with self.subTest(sql=sql):
                self.assert_refused(sql)

    def test_refuses_row_locks_credential_catalogs_and_odd_text(self):
        for sql in (
            "select * from t for update;",
            "select * from t for no key update;",
            "select * from t for share;",
            "table pg_authid;",
            "select * from pg_shadow;",
            "select 1 \u2215 2;",
            "select $1;",
            "select `id`;",
            "select 'unterminated;",
            'select "unterminated;',
            "select u&'x';",
            ";\n",
        ):
            with self.subTest(sql=sql):
                self.assert_refused(sql)

    def test_names_the_line_of_the_refusal(self):
        run = self.assert_refused("select 1;\nselect 2;\nselect pg_sleep(1);\n")

        self.assertIn("on line 3", run.result.stderr)


class FileTest(Case):
    def test_refuses_a_missing_empty_or_oversized_file(self):
        for run in (self.run_sql(None), self.run_sql(""), self.run_sql("select 1;\n" + "select 2;\n" * 7000)):
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
