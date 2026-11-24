"""Runs the session role check from scripts/prod-sql.sh against a real local PostgreSQL.

Run: python3 scripts/prod-sql-role-check.test.py

It needs psql and a local server where the current libpq user is a superuser,
and skips with a message otherwise, so CI without PostgreSQL stays green. It
creates a throwaway database and roles with a random suffix and drops them at
the end. It never connects anywhere but the local default libpq target.
"""

import os
import shutil
import subprocess
import unittest
import uuid

SCRIPT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "prod-sql.sh")
SUFFIX = uuid.uuid4().hex[:8]
DATABASE = f"prodsql_check_{SUFFIX}"
OWNED_DATABASE = f"prodsql_owned_{SUFFIX}"
EPILOGUE = "\n;\nROLLBACK;\n"
CALLER_MARKER = "caller sql ran"
REFUSAL = "the connected role is not read-only"


def role(name):
    return f"prodsql_{name}_{SUFFIX}"


def psql(*args, user=None, database="postgres", stdin=None):
    command = ["psql", "-X", "-q", "-A", "-t", "-v", "ON_ERROR_STOP=1", "-d", database]
    if user is not None:
        command += ["-U", user]
    return subprocess.run(
        [*command, *args],
        input=stdin,
        capture_output=True,
        text=True,
        timeout=60,
        env={**os.environ, "PGCONNECT_TIMEOUT": "3"},
    )


def local_superuser_available():
    if shutil.which("psql") is None:
        return "psql is not installed"
    try:
        probe = psql("-c", "select rolsuper from pg_catalog.pg_roles where rolname = current_user")
    except subprocess.TimeoutExpired:
        return "the local PostgreSQL server did not answer"
    if probe.returncode != 0:
        return "no local PostgreSQL server is reachable"
    if probe.stdout.strip() != "t":
        return "the local PostgreSQL user is not a superuser"
    return None


def session_preamble():
    return subprocess.run(
        ["bash", "-c", 'eval "$(sed -n "/^session_preamble() {/,/^}/p" "$1")" && session_preamble', "preamble", SCRIPT],
        capture_output=True,
        text=True,
        check=True,
    ).stdout


SETUP = [
    f"create database {DATABASE}",
    f"create role {role('select_only')} login",
    f"create role {role('inserter')} login",
    f"create role {role('owner')} login",
    f"create role {role('writer')} nologin",
    f"create role {role('set_role_member')} login noinherit",
    f"create role {role('noinherit_member')} login noinherit",
    f"create role {role('shadowed')} login",
    f"create role {role('sequence_user')} login",
    f"create role {role('trigger_holder')} login",
    f"create role {role('references_holder')} login",
    f"create role {role('schema_owner')} login",
    f"create role {role('database_owner')} login",
    f"create role {role('function_owner')} login",
    f"create role {role('public_creator')} login",
    f"create role {role('database_creator')} login",
    f"create role {role('temp_creator')} login",
    f"create database {OWNED_DATABASE} owner {role('database_owner')}",
    f"revoke temporary on database {DATABASE} from public",
    f"grant create on database {DATABASE} to {role('database_creator')}",
    f"grant temporary on database {DATABASE} to {role('temp_creator')}",
    f"grant {role('writer')} to {role('set_role_member')}",
    f"grant {role('writer')} to {role('noinherit_member')}",
    f"alter role {role('set_role_member')} set role = '{role('writer')}'",
    f"alter role {role('shadowed')} set search_path = shadow, pg_catalog",
]

DATABASE_SETUP = [
    "revoke create on schema public from public",
    "create table t (id int)",
    f"grant trigger on t to {role('trigger_holder')}",
    f"grant references on t to {role('references_holder')}",
    f"create schema owned_schema authorization {role('schema_owner')}",
    "create function plain_answer() returns int language sql as 'select 1'",
    f"alter function plain_answer() owner to {role('function_owner')}",
    f"grant create on schema public to {role('public_creator')}",
    "create sequence s",
    f"grant select on t to {role('select_only')}, {role('inserter')}, {role('writer')}, {role('shadowed')}, {role('sequence_user')}",
    f"grant insert on t to {role('inserter')}, {role('writer')}, {role('shadowed')}",
    f"grant usage on sequence s to {role('sequence_user')}",
    f"create table owned_t (id int)",
    f"alter table owned_t owner to {role('owner')}",
    "create schema shadow",
    "create view shadow.pg_class as select * from pg_catalog.pg_class where false",
    "create view shadow.pg_namespace as select * from pg_catalog.pg_namespace where false",
    f"grant usage on schema shadow to {role('shadowed')}",
    f"grant select on all tables in schema shadow to {role('shadowed')}",
]

ROLES = [
    "select_only", "inserter", "owner", "writer", "set_role_member", "noinherit_member", "shadowed", "sequence_user",
    "trigger_holder", "references_holder", "schema_owner", "database_owner", "function_owner", "public_creator",
    "database_creator", "temp_creator",
]


class RealRoleCheckTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        reason = local_superuser_available()
        if reason is not None:
            raise unittest.SkipTest(f"skipping the real PostgreSQL role check: {reason}")
        cls.preamble = session_preamble()
        for statement in SETUP:
            result = psql("-c", statement)
            if result.returncode != 0:
                cls.tearDownClass()
                raise RuntimeError(f"setup failed: {statement}: {result.stderr}")
        for statement in DATABASE_SETUP:
            result = psql("-c", statement, database=DATABASE)
            if result.returncode != 0:
                cls.tearDownClass()
                raise RuntimeError(f"setup failed: {statement}: {result.stderr}")

    @classmethod
    def tearDownClass(cls):
        psql("-c", f"drop database if exists {DATABASE}")
        psql("-c", f"drop database if exists {OWNED_DATABASE}")
        for name in ROLES:
            psql("-c", f"drop role if exists {role(name)}")

    def run_as(self, user, database=DATABASE):
        return psql("-f", "-", user=user, database=database, stdin=self.preamble + f"select '{CALLER_MARKER}';\n" + EPILOGUE)

    def assert_refused(self, user, reason, database=DATABASE):
        result = self.run_as(user, database)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn(REFUSAL, result.stderr)
        self.assertIn(reason, result.stderr)
        self.assertNotIn(CALLER_MARKER, result.stdout)

    def test_a_select_only_role_passes_and_runs_the_callers_sql(self):
        result = self.run_as(role("select_only"))

        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn(CALLER_MARKER, result.stdout)
        self.assertNotIn(REFUSAL, result.stderr)

    def test_refuses_a_superuser(self):
        self.assert_refused(None, "has superuser")

    def test_refuses_a_role_that_can_insert(self):
        self.assert_refused(role("inserter"), "can own or write public.t")

    def test_refuses_a_role_that_owns_a_table(self):
        self.assert_refused(role("owner"), "owns or can act as the owner of table owned_t")

    def test_refuses_a_role_whose_setting_switches_to_a_writer(self):
        self.assert_refused(role("set_role_member"), "not the session role")

    def test_refuses_a_noinherit_member_of_a_writer(self):
        self.assert_refused(role("noinherit_member"), "can own or write public.t")

    def test_refuses_a_writer_whose_search_path_shadows_the_catalog(self):
        self.assert_refused(role("shadowed"), "can own or write public.t")

    def test_refuses_a_role_that_can_use_a_sequence(self):
        self.assert_refused(role("sequence_user"), "can own or write public.s")


    def test_refuses_a_role_holding_trigger_on_a_table(self):
        self.assert_refused(role("trigger_holder"), "can own or write public.t")

    def test_refuses_a_role_holding_references_on_a_table(self):
        self.assert_refused(role("references_holder"), "can own or write public.t")

    def test_refuses_the_owner_of_a_schema(self):
        self.assert_refused(role("schema_owner"), "owns or can act as the owner of schema owned_schema")

    def test_refuses_the_owner_of_a_database(self):
        self.assert_refused(role("database_owner"), f"owns or can act as the owner of database {OWNED_DATABASE}", database=OWNED_DATABASE)

    def test_refuses_the_owner_of_a_function(self):
        self.assert_refused(role("function_owner"), "owns or can act as the owner of function plain_answer()")

    def test_refuses_create_on_the_public_schema(self):
        self.assert_refused(role("public_creator"), "can create in schema public")

    def test_refuses_create_on_the_database(self):
        self.assert_refused(role("database_creator"), "can create or make temporary tables in this database")

    def test_refuses_temporary_on_the_database(self):
        self.assert_refused(role("temp_creator"), "can create or make temporary tables in this database")


if __name__ == "__main__":
    unittest.main()
