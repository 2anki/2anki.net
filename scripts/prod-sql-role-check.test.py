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
    f"grant {role('writer')} to {role('set_role_member')}",
    f"grant {role('writer')} to {role('noinherit_member')}",
    f"alter role {role('set_role_member')} set role = '{role('writer')}'",
    f"alter role {role('shadowed')} set search_path = shadow, pg_catalog",
]

DATABASE_SETUP = [
    "create table t (id int)",
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

ROLES = ["select_only", "inserter", "owner", "writer", "set_role_member", "noinherit_member", "shadowed", "sequence_user"]


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
        for name in ROLES:
            psql("-c", f"drop role if exists {role(name)}")

    def run_as(self, user):
        return psql("-f", "-", user=user, database=DATABASE, stdin=self.preamble + f"select '{CALLER_MARKER}';\n" + EPILOGUE)

    def assert_refused(self, user):
        result = self.run_as(user)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn(REFUSAL, result.stderr)
        self.assertNotIn(CALLER_MARKER, result.stdout)

    def test_a_select_only_role_passes_and_runs_the_callers_sql(self):
        result = self.run_as(role("select_only"))

        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn(CALLER_MARKER, result.stdout)
        self.assertNotIn(REFUSAL, result.stderr)

    def test_refuses_a_superuser(self):
        self.assert_refused(None)

    def test_refuses_a_role_that_can_insert(self):
        self.assert_refused(role("inserter"))

    def test_refuses_a_role_that_owns_a_table(self):
        self.assert_refused(role("owner"))

    def test_refuses_a_role_whose_setting_switches_to_a_writer(self):
        self.assert_refused(role("set_role_member"))

    def test_refuses_a_noinherit_member_of_a_writer(self):
        self.assert_refused(role("noinherit_member"))

    def test_refuses_a_writer_whose_search_path_shadows_the_catalog(self):
        self.assert_refused(role("shadowed"))

    def test_refuses_a_role_that_can_use_a_sequence(self):
        self.assert_refused(role("sequence_user"))


if __name__ == "__main__":
    unittest.main()
