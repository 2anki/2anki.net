"""Tests for scripts/wait-pr.py. Run: python3 scripts/wait-pr.test.py"""

import importlib.util
import io
import os
import unittest

spec = importlib.util.spec_from_file_location(
    "wait_pr", os.path.join(os.path.dirname(os.path.abspath(__file__)), "wait-pr.py")
)
wait_pr = importlib.util.module_from_spec(spec)
spec.loader.exec_module(wait_pr)


def run(name, status="COMPLETED", conclusion="SUCCESS"):
    return {"__typename": "CheckRun", "name": name, "status": status, "conclusion": conclusion if status == "COMPLETED" else ""}


def context(name, state):
    return {"__typename": "StatusContext", "context": name, "state": state}


def view(checks, head="bbbbbbb", merge_state="CLEAN", state="OPEN"):
    return {"state": state, "mergeStateStatus": merge_state, "headRefOid": head, "statusCheckRollup": checks}


class DecideTest(unittest.TestCase):
    def test_green_when_every_check_passed(self):
        verdict, report = wait_pr.decide(view([run("test"), run("static"), context("netlify", "SUCCESS")]))

        self.assertEqual(verdict, "green")
        self.assertEqual(report["not_green"], [])
        self.assertEqual(report["test_checks"], ["test: SUCCESS"])

    def test_waits_while_a_check_runs(self):
        self.assertEqual(wait_pr.decide(view([run("test", status="IN_PROGRESS"), run("static")]))[0], "wait")
        self.assertEqual(wait_pr.decide(view([run("static"), context("netlify", "PENDING")]))[0], "wait")

    def test_waits_until_the_head_moves_past_the_old_sha(self):
        self.assertEqual(wait_pr.decide(view([run("test")], head="aaaaaaa"), "aaaaaaa")[0], "wait")
        self.assertEqual(wait_pr.decide(view([run("test")], head="bbbbbbb"), "aaaaaaa")[0], "green")

    def test_waits_while_behind_or_unknown(self):
        for merge_state in ("BEHIND", "UNKNOWN"):
            with self.subTest(merge_state=merge_state):
                self.assertEqual(wait_pr.decide(view([run("test")], merge_state=merge_state))[0], "wait")

    def test_waits_until_checks_are_reported(self):
        self.assertEqual(wait_pr.decide(view([]))[0], "wait")

    def test_a_blocked_merge_state_is_still_green(self):
        self.assertEqual(wait_pr.decide(view([run("test")], merge_state="BLOCKED"))[0], "green")

    def test_names_every_check_that_is_not_green(self):
        checks = [run("test"), run("static", conclusion="FAILURE"), run("e2e", conclusion="CANCELLED"), context("ci/x", "ERROR")]
        verdict, report = wait_pr.decide(view(checks))

        self.assertEqual(verdict, "not green")
        self.assertEqual(report["not_green"], ["static: FAILURE", "e2e: CANCELLED", "ci/x: ERROR"])

    def test_a_skipped_test_check_is_not_green_but_a_skipped_other_check_is(self):
        verdict, report = wait_pr.decide(view([run("test", conclusion="SKIPPED"), run("dependabot", conclusion="SKIPPED")]))

        self.assertEqual(verdict, "not green")
        self.assertEqual(report["not_green"], ["test: SKIPPED"])

    def test_conflicts_are_not_green(self):
        verdict, report = wait_pr.decide(view([run("test")], merge_state="DIRTY"))

        self.assertEqual(verdict, "not green")
        self.assertEqual(report["not_green"], ["merge state: DIRTY"])

    def test_a_closed_pr_ends_the_wait_with_its_running_checks_named(self):
        verdict, report = wait_pr.decide(view([run("test", status="QUEUED")], state="CLOSED"))

        self.assertEqual(verdict, "not green")
        self.assertEqual(report["state"], "CLOSED")
        self.assertEqual(report["not_green"], ["test: RUNNING"])


class Clock:
    def __init__(self):
        self.t = 0.0

    def now(self):
        return self.t

    def sleep(self, seconds):
        self.t += seconds


class WaitTest(unittest.TestCase):
    def wait(self, views, timeout=100, old_sha=None):
        clock = Clock()
        remaining = list(views)
        out = io.StringIO()
        code = wait_pr.wait(lambda: remaining.pop(0) if remaining else views[-1], old_sha, timeout, 30, clock.sleep, clock.now, out)
        return code, out.getvalue(), clock.t

    def test_exits_0_once_checks_finish_green(self):
        code, out, waited = self.wait([view([run("test", status="IN_PROGRESS")]), view([run("test")])])

        self.assertEqual(code, wait_pr.GREEN)
        self.assertEqual(waited, 30)
        self.assertIn("green: OPEN CLEAN bbbbbbb", out)

    def test_exits_1_when_a_check_failed(self):
        code, out, _ = self.wait([view([run("test", conclusion="FAILURE")])])

        self.assertEqual(code, wait_pr.NOT_GREEN)
        self.assertIn("not green: ['test: FAILURE']", out)

    def test_exits_3_on_timeout(self):
        code, out, waited = self.wait([view([run("test", status="IN_PROGRESS")])], timeout=90)

        self.assertEqual(code, wait_pr.TIMED_OUT)
        self.assertEqual(waited, 90)
        self.assertIn("1 checks running", out)

    def test_keeps_polling_through_a_failed_gh_call(self):
        code, _, waited = self.wait([None, view([run("test")])])

        self.assertEqual(code, wait_pr.GREEN)
        self.assertEqual(waited, 30)

    def test_times_out_when_gh_never_answers(self):
        code, out, _ = self.wait([None], timeout=60)

        self.assertEqual(code, wait_pr.TIMED_OUT)
        self.assertIn("gh never returned the PR", out)


class ArgumentTest(unittest.TestCase):
    def test_refuses_a_pr_that_is_not_a_number(self):
        for argv in (["abc"], ["12; rm"], ["0"], ["12", "NOTHEX"], ["12", "--timeout", "-1"]):
            with self.subTest(argv=argv):
                with self.assertRaises(SystemExit) as raised, io.StringIO() as sink:
                    stderr = wait_pr.sys.stderr
                    wait_pr.sys.stderr = sink
                    try:
                        wait_pr.parse_args(argv)
                    finally:
                        wait_pr.sys.stderr = stderr
                self.assertEqual(raised.exception.code, 2)

    def test_reads_the_pr_old_sha_and_timeout(self):
        args = wait_pr.parse_args(["5469", "abc1234", "--timeout", "600"])

        self.assertEqual((args.pr, args.old_sha, args.timeout, args.interval), ("5469", "abc1234", 600, 30))


if __name__ == "__main__":
    unittest.main()
