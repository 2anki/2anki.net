#!/usr/bin/env python3
import importlib.util
import os
import unittest

HOOKS_DIR = os.path.dirname(os.path.abspath(__file__))
_spec = importlib.util.spec_from_file_location(
    "sonar_gate", os.path.join(HOOKS_DIR, "sonar_gate.py")
)
gate = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(gate)

HEAD = "44725c2ac624470947272d57728ec23d834e6773"
OLD = "9242d282f5acc1b1bcdc59ee440faf5ba4244f72"


def fake_fetch(pull_requests=None, issues=None, error=None):
    def fetch(url):
        if error is not None:
            raise error
        if "project_pull_requests/list" in url:
            return {"pullRequests": pull_requests or []}
        if "issues/search" in url:
            return {"total": len(issues or []), "issues": issues or []}
        raise AssertionError(f"unexpected url {url}")
    return fetch


def pr_entry(key="4244", sha=HEAD, qg="OK"):
    return {"key": key, "commit": {"sha": sha}, "status": {"qualityGateStatus": qg}}


class TestEvaluate(unittest.TestCase):
    def test_clean_analysis_on_head_passes(self):
        ok, reason = gate.evaluate("4244", HEAD, fake_fetch([pr_entry()]))
        self.assertTrue(ok)
        self.assertIn(HEAD[:7], reason)

    def test_short_head_sha_prefix_matches_full_analysis_sha(self):
        ok, _ = gate.evaluate("4244", HEAD[:12], fake_fetch([pr_entry()]))
        self.assertTrue(ok)

    def test_head_sha_shorter_than_seven_never_matches(self):
        self.assertEqual(gate.classify("4244", HEAD[:6], fake_fetch([pr_entry()])), gate.PENDING)

    def test_missing_analysis_fails_as_pending(self):
        ok, reason = gate.evaluate("4244", HEAD, fake_fetch([pr_entry(key="1")]))
        self.assertFalse(ok)
        self.assertEqual(gate.classify("4244", HEAD, fake_fetch([pr_entry(key="1")])), gate.PENDING)

    def test_analysis_for_older_sha_is_pending(self):
        fetch = fake_fetch([pr_entry(sha=OLD)])
        self.assertEqual(gate.classify("4244", HEAD, fetch), gate.PENDING)
        ok, reason = gate.evaluate("4244", HEAD, fetch)
        self.assertFalse(ok)
        self.assertIn(OLD[:7], reason)

    def test_quality_gate_error_fails_definitively(self):
        fetch = fake_fetch([pr_entry(qg="ERROR")])
        self.assertEqual(gate.classify("4244", HEAD, fetch), gate.FAILED)

    def test_open_findings_fail_definitively(self):
        issues = [{"status": "OPEN", "rule": "typescript:S8786", "component": "a:src/x.ts", "line": 3, "message": "m"}]
        fetch = fake_fetch([pr_entry()], issues)
        self.assertEqual(gate.classify("4244", HEAD, fetch), gate.FAILED)
        ok, reason = gate.evaluate("4244", HEAD, fetch)
        self.assertIn("typescript:S8786", reason)

    def test_closed_records_leaking_through_filter_do_not_count(self):
        issues = [{"status": "CLOSED", "rule": "typescript:S1", "component": "a:src/x.ts", "line": 1, "message": "m"}]
        ok, _ = gate.evaluate("4244", HEAD, fake_fetch([pr_entry()], issues))
        self.assertTrue(ok)

    def test_network_error_fails_closed(self):
        fetch = fake_fetch(error=OSError("boom"))
        self.assertEqual(gate.classify("4244", HEAD, fetch), gate.FAILED)
        ok, reason = gate.evaluate("4244", HEAD, fetch)
        self.assertFalse(ok)
        self.assertIn("unreachable", reason)


class TestWait(unittest.TestCase):
    def test_polls_until_analysis_lands(self):
        calls = {"n": 0}
        responses = [[pr_entry(sha=OLD)], [pr_entry(sha=OLD)], [pr_entry()]]

        def fetch(url):
            if "project_pull_requests/list" in url:
                idx = min(calls["n"], len(responses) - 1)
                calls["n"] += 1
                return {"pullRequests": responses[idx]}
            return {"total": 0, "issues": []}

        slept = []
        ok, _ = gate.wait_for_clean("4244", HEAD, wait_seconds=60, fetch=fetch, sleep=slept.append)
        self.assertTrue(ok)
        self.assertEqual(len(slept), 2)

    def test_definitive_failure_returns_without_waiting(self):
        slept = []
        ok, _ = gate.wait_for_clean(
            "4244", HEAD, wait_seconds=60,
            fetch=fake_fetch([pr_entry(qg="ERROR")]), sleep=slept.append,
        )
        self.assertFalse(ok)
        self.assertEqual(slept, [])

    def test_timeout_fails(self):
        slept = []
        ok, reason = gate.wait_for_clean(
            "4244", HEAD, wait_seconds=30,
            fetch=fake_fetch([pr_entry(sha=OLD)]), sleep=slept.append,
        )
        self.assertFalse(ok)
        self.assertEqual(sum(slept), 30)


if __name__ == "__main__":
    unittest.main()
