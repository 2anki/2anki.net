"""Tests for scripts/prod-sql.sh. Run: python3 scripts/prod-sql.test.py

A fake ssh runs the remote command locally, the way sshd hands it to the login
shell; a fake timeout and psql record what they were given. Nothing touches the
network.
"""

import concurrent.futures
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
    "SET client_encoding = 'UTF8';\n"
    "SET standard_conforming_strings = on;\n"
    "SET statement_timeout = '120s';\n"
    "SET lock_timeout = '5s';\n"
    "SET idle_in_transaction_session_timeout = '60s';\n"
    "SET temp_file_limit = '1GB';\n"
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
        self.tmp_dir = os.path.join(root, "tmp")
        os.makedirs(bin_dir)
        os.makedirs(self.tmp_dir)
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
            env={
                **environment,
                "HOME": home,
                "FAKE_DIR": root,
                "TMPDIR": self.tmp_dir,
                "PATH": bin_dir + os.pathsep + os.environ["PATH"],
            },
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

    def run_many(self, sqls):
        with concurrent.futures.ThreadPoolExecutor(max_workers=8) as pool:
            runs = list(pool.map(lambda sql: Run(sql, env_file=app_env()), sqls))
        for run in runs:
            self.addCleanup(run.close)
        return runs

    def assert_each_refused(self, sqls):
        for sql, run in zip(sqls, self.run_many(sqls)):
            with self.subTest(sql=sql):
                self.assertEqual(run.result.returncode, 5, run.result.stderr)
                self.assertIn("refused:", run.result.stderr)
                self.assertIsNone(run.recorded("ssh-args"))

    def assert_each_accepted(self, sqls):
        for sql, run in zip(sqls, self.run_many(sqls)):
            with self.subTest(sql=sql):
                self.assertEqual(run.result.returncode, 0, run.result.stderr)
                self.assertTrue(run.recorded("psql-stdin").startswith(PREAMBLE + sql))

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

        env = run.psql_env()
        options = env["PGOPTIONS"]
        self.assertIn("-c default_transaction_read_only=on", options)
        self.assertIn("-c standard_conforming_strings=on", options)
        self.assertIn("-c statement_timeout=120000", options)
        self.assertIn("-c lock_timeout=5000", options)
        self.assertIn("-c temp_file_limit=1GB", options)
        self.assertEqual(env["PGCLIENTENCODING"], "UTF8")

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
    def test_accepts_each_family_on_the_function_list(self):
        self.assert_each_accepted((
            "select count(*), sum(n), avg(n), min(n), max(n), bool_and(b), bool_or(b) from t;",
            "select array_agg(x), string_agg(x, ','), jsonb_agg(x), mode() within group (order by x) from t;",
            "select percentile_cont(0.5) within group (order by n), percentile_disc(0.9) within group (order by n) from t;",
            "select coalesce(a, 0), nullif(a, 0), greatest(a, b), least(a, b), cast(a as integer) from t;",
            "select now(), date_trunc('week', d), date_part('hour', d), extract(epoch from d), age(d) from t;",
            "select make_interval(days => 3), to_char(d, 'YYYY-MM'), to_timestamp(0), timezone('UTC', d) from t;",
            "select lower(s), upper(s), length(s), left(s, 2), right(s, 2), substr(s, 1, 2), substring(s from 1 for 2) from t;",
            "select position('a' in s), strpos(s, 'a'), split_part(s, '.', 1), trim(both 'x' from s), btrim(s) from t;",
            "select ltrim(s), rtrim(s), replace(s, 'a', 'b'), regexp_replace(s, '[0-9]+', 'N', 'g'), regexp_match(s, 'a') from t;",
            "select concat(a, b), concat_ws('-', a, b), format('%s', a), md5(s) from t;",
            "select round(n, 2), floor(n), ceil(n), abs(n), width_bucket(n, 0, 100, 10) from t;",
            "select jsonb_array_length(j), jsonb_typeof(j), jsonb_extract_path_text(j, 'k'), to_jsonb(s) from t;",
            "select k from t, jsonb_object_keys(j) as k;",
            "select e from t, jsonb_array_elements(j) as e, jsonb_array_elements_text(j) as x;",
            "select g from generate_series(1, 3) as g(n), unnest(array[1, 2]) as u(v);",
            "select row_number() over (order by d), rank() over w, dense_rank() over w, ntile(4) over w from t window w as (order by d);",
            "select lag(n) over (order by d), lead(n) over (order by d), first_value(n) over (order by d), last_value(n) over (order by d) from t;",
            "select pg_size_pretty(pg_total_relation_size('users')), pg_relation_size('users'), pg_database_size(current_database());",
            "select pg_has_role('x', 'member'), version();",
            "select pg_catalog.count(*) from t;",
        ))

    def test_accepts_keywords_that_look_like_calls(self):
        self.assert_each_accepted((
            "select 1 from t where a in (1, 2) and exists (select 1) and b = any (array[1]) and c > all (select 1);",
            "select count(*) filter (where a) from t;",
            "select x from (values (1), (2)) as v(x);",
            "with recent (id) as (select id from t) select id from recent;",
            "with recent as (select id from t) select * from t join recent on (t.id = recent.id) join u using (id);",
            "select now() - interval '7 days', n::numeric(10,2), s::varchar(20), d::timestamp(0) from t;",
            "select cast(n as numeric(10, 2)), d::timestamptz from t where (a or b) and not (c);",
            "select case when (a) then (1) else (2) end from t group by rollup (a);",
            "select a[1:2], a[1 : 2] from t;",
        ))

    def test_accepts_other_statement_starts_and_explain_options(self):
        self.assert_each_accepted((
            "explain select 1;",
            "explain (format json) select 1;",
            "explain (costs off, verbose, settings on, format yaml) with x as (select 1) select * from x;",
            "show statement_timeout;",
            "table knex_migrations;",
        ))

    def test_accepts_quoted_identifiers_and_string_contents_with_any_words(self):
        self.assert_each_accepted((
            'select "createdAt", "userId" from "Events" where "type" = \'x\';',
            "select 'café; with a semicolon', 'insert pg_sleep(1) set' as label from t where name = 'e' and kind = 'it''s';",
            "select deleted_at, updated_at, created_at from uploads order by 1 desc limit 5;\nselect 2",
        ))

    def test_accepts_backslashes_and_dollar_signs_inside_strings(self):
        self.assert_each_accepted((
            "select regexp_replace(s, '\\s+', ' ', 'g') from t where s ~ '[^\\x00-\\x7F]';",
            "select count(*) from t where s ~ '^[0-9]+$';",
            "select case when a then 'x' else'y' end from t;",
        ))

    def test_accepts_references_after_a_dot_that_are_not_calls(self):
        self.assert_each_accepted((
            "select (t).* from t;",
            "select t.created_at, u.id from users t join uploads u on u.owner = t.id;",
            "select count(*) from public.users;",
            "select (select 1) as x, (select max(id) from t) + 1;",
            "select (array[1, 2])[1], a[2] from t;",
            "select (s).lower from t;",
        ))

    def test_accepts_a_section_label_written_as_a_statement(self):
        self.assert_each_accepted(("select '== signups' as section;\nselect count(*) from users;",))


class RefusedTest(Case):
    def test_refuses_each_earlier_probe_before_anything_is_sent(self):
        self.assert_each_refused((
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
        ))

    def test_refuses_functions_that_are_not_on_the_list(self):
        self.assert_each_refused((
            "select * from crosstab('select 1');",
            "select * from crosstab2('select 1');",
            "select * from connectby('t', 'a', 'b', '1', 0);",
            "select query_to_xml('select 1', true, true, '');",
            "select table_to_xml('t', true, true, '');",
            "select schema_to_xml('public', true, true, '');",
            "select database_to_xml(true, true, '');",
            "select cursor_to_xml('c', 1, true, true, '');",
            "select brin_summarize_new_values('i');",
            "select brin_summarize_range('i', 0);",
            "select gin_clean_pending_list('i');",
            "select pg_sleep(1);",
            "select pg_catalog.pg_sleep\n  (1);",
            "select pg_advisory_lock(1);",
            "select nextval('s');",
            "select lo_export(1, '/tmp/x');",
            "select pg_read_file('/etc/hosts');",
            "select dblink('x', 'y');",
            "select pg_notify('c', 'x');",
            "select pg_reload_conf();",
            "select operator(pg_catalog.+) 1;",
        ))

    def test_refuses_an_app_defined_function_by_name(self):
        for sql in ("select similarity('a', 'b');", "select set_limit(0.5);", "select show_trgm('a');"):
            with self.subTest(sql=sql):
                run = self.assert_refused(sql)
                self.assertIn("not on the function list", run.result.stderr)
                self.assertIn("add it to ALLOWED_FUNCTIONS in a reviewed PR", run.result.stderr)

    def test_names_the_function_and_its_line(self):
        run = self.assert_refused("select 1;\nselect 2;\nselect similarity('a', 'b');\n")

        self.assertIn("calls similarity on line 3", run.result.stderr)

    def test_reads_quoted_identifiers_by_their_contents(self):
        self.assert_each_refused((
            'select "pg_sleep"(1);',
            'select "PG_SLEEP" (1);',
            'select "count"(*) from "pg_authid";',
            'select * from "PG_SHADOW";',
            'select * from pg_catalog."pg_stats";',
            'explain ("analyze") select 1;',
            'explain ("ANALYZE" true) select 1;',
            'select "insert" from t;',
            'select * from "public".t where "set" = 1;',
        ))

    def test_refuses_a_schema_other_than_pg_catalog_before_a_call(self):
        self.assert_each_refused((
            "select public.lower('x');",
            "select cron.schedule('a', 'b');",
            'select "public".similarity(\'a\', \'b\');',
            'select "pg_catalog"."pg_sleep"(1);',
            'select "my_schema"."count"(*) from t;',
            "select db.pg_catalog.count(*) from t;",
        ))

    def test_refuses_role_credential_and_statistics_catalogs(self):
        self.assert_each_refused((
            "table pg_authid;",
            "select * from pg_shadow;",
            "select * from pg_user_mappings;",
            "select * from pg_largeobject;",
            "select * from pg_statistic;",
            "select * from pg_stats;",
            "select * from pg_catalog.pg_hba_file_rules;",
            "select subname from pg_subscription;",
            'select * from "PG_SUBSCRIPTION";',
        ))

    def test_refuses_a_call_written_as_a_name_after_a_dot(self):
        self.assert_each_refused((
            "select (1).pg_sleep;",
            "select ('x').similarity;",
            "select (array[1])[1].pg_sleep;",
            "select a[1].pg_sleep from t;",
            "select (select 1).pg_sleep;",
            "select (1) . pg_sleep;",
            "select (1)\n.\npg_sleep;",
            'select (1)."pg_sleep";',
            'select (1)."PG_SLEEP";',
            "select (t).col from t;",
        ))

    def test_refuses_escape_strings_and_backslashes_outside_strings(self):
        self.assert_each_refused((
            "select E'x';",
            "select e'x';",
            "select 1e'x';",
            "select 1.5e'x';",
            "select (e'x');",
            "select U&'x';",
            "select 1 \\ 2;",
            "select 'a' \\g",
            "select $tag$x$tag$;",
        ))

    def test_refuses_explain_options_beyond_format_costs_verbose_and_settings(self):
        self.assert_each_refused((
            "explain analyze select 1;",
            "explain analyse select 1;",
            "explain (analyze) select 1;",
            "explain (analyse true) select 1;",
            "explain (buffers) select 1;",
            "explain (timing off) select 1;",
            "explain (wal) select 1;",
            "explain (summary) select 1;",
            "explain verbose select 1;",
            "explain (format 'json') select 1;",
            "explain (costs maybe) select 1;",
            "explain (format json select 1;",
            "explain values (1);",
        ))

    def test_refuses_psql_variables(self):
        for sql in ("select :foo;", "select :'foo';", 'select :"foo";', "select :{?foo};", "select a:b from t;"):
            with self.subTest(sql=sql):
                run = self.assert_refused(sql)
                self.assertIn("psql reads as a variable", run.result.stderr)

    def test_refuses_a_byte_order_mark_and_a_nul(self):
        for sql in (b"\xef\xbb\xbfselect 1;\n", b"select 1;\x00\n"):
            with self.subTest(sql=sql):
                self.assert_refused(sql)

    def test_refuses_statements_outside_the_allowlist(self):
        self.assert_each_refused((
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
            '"select" 1;',
        ))

    def test_refuses_row_locks_and_odd_text(self):
        self.assert_each_refused((
            "select * from t for update;",
            "select * from t for no key update;",
            "select * from t for share;",
            "select * from t for key share;",
            "select 1 \u2215 2;",
            "select $1;",
            "select `id`;",
            "select 'unterminated;",
            'select "unterminated;',
            "select u&'x';",
            "select e'x';",
            "select \"caf\u00e9\" from t;",
            ";\n",
        ))


class FileTest(Case):
    def test_refuses_a_missing_empty_or_oversized_file(self):
        for run in (self.run_sql(None), self.run_sql(""), self.run_sql("select 1;\n" + "select 2;\n" * 7000)):
            with self.subTest(stderr=run.result.stderr):
                self.assertEqual(run.result.returncode, 2)
                self.assertIsNone(run.recorded("ssh-args"))

    def test_removes_its_copy_of_the_file(self):
        for sql in ("select 1;\n", "select pg_sleep(1);\n"):
            with self.subTest(sql=sql):
                run = self.run_sql(sql, env_file=app_env())
                self.assertEqual(os.listdir(run.tmp_dir), [])

    def test_refuses_a_directory_or_extra_arguments(self):
        for args in ([], ["/"], ["a.sql", "b.sql"]):
            with self.subTest(args=args):
                run = self.run_sql(None, raw_args=args)
                self.assertEqual(run.result.returncode, 2)
                self.assertIsNone(run.recorded("ssh-args"))


if __name__ == "__main__":
    unittest.main()
