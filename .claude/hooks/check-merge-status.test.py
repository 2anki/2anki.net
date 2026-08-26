#!/usr/bin/env python3
import importlib.util
import json
import os
import sys
import unittest
from unittest.mock import MagicMock, patch

HOOKS_DIR = os.path.dirname(os.path.abspath(__file__))
_spec = importlib.util.spec_from_file_location(
    "check_merge_status", os.path.join(HOOKS_DIR, "check-merge-status.py")
)
hook = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(hook)

HEAD = "44725c2ac624470947272d57728ec23d834e6773"
OLD = "9242d282f5acc1b1bcdc59ee440faf5ba4244f72"
MARKER = f"<!-- ship-review: pass sha={HEAD} -->"


def check(name, conclusion="SUCCESS", status="COMPLETED"):
    return {"name": name, "conclusion": conclusion, "status": status}


GREEN = [check("static (22.20.0)"), check("test (22.20.0)"), check("build (22.20.0)"), check("playwright (22.20.0)")]


def pr_json(files, rollup=None, author="aalemayhu", reviews=None, comments=None, head=HEAD, number=4244):
    return json.dumps({
        "number": number,
        "headRefOid": head,
        "author": {"login": author},
        "files": [{"path": f} for f in files],
        "statusCheckRollup": GREEN if rollup is None else rollup,
        "reviews": [{"body": b} for b in (reviews or [])],
        "comments": [{"body": b} for b in (comments or [])],
    })


def run_hook(command, pr_stdout, diff_stdout="", sonar=(True, "SonarCloud clean"), env=None, tool_name="Bash", diff_fails=False):
    captured = {}

    def fake_allow():
        captured["result"] = "allow"
        sys.exit(0)

    def fake_deny(reason):
        captured["result"] = "deny"
        captured["reason"] = reason
        sys.exit(0)

    def fake_run(args, **kwargs):
        if "diff" in args:
            return MagicMock(returncode=1 if diff_fails else 0, stdout=diff_stdout, stderr="boom")
        return MagicMock(returncode=0, stdout=pr_stdout, stderr="")

    with patch.object(hook, "allow", side_effect=fake_allow), \
         patch.object(hook, "deny", side_effect=fake_deny), \
         patch.object(hook.sonar_gate, "evaluate", return_value=sonar), \
         patch("subprocess.run", side_effect=fake_run), \
         patch("sys.stdin") as mock_stdin, \
         patch.dict(os.environ, env or {}, clear=False):
        os.environ.pop("CLAUDE_SKIP_SAFETY", None) if not env else None
        mock_stdin.read.return_value = json.dumps({"tool_name": tool_name, "tool_input": {"command": command}})
        try:
            hook.main()
        except SystemExit:
            pass
    return captured


CLEAN_FILES = ["src/lib/parser/DeckParser.ts", "src/lib/parser/DeckParser.test.ts"]


class TestNonMerge(unittest.TestCase):
    def test_non_merge_command_allows(self):
        self.assertEqual(run_hook("gh pr view 4244", pr_json(CLEAN_FILES))["result"], "allow")

    def test_skip_safety_prefix_in_command_is_not_honored(self):
        result = run_hook("CLAUDE_SKIP_SAFETY=1 gh pr merge 4244 --squash", pr_json(["src/lib/isPaying.ts"]))
        self.assertEqual(result["result"], "deny")

    def test_skip_safety_env_allows(self):
        result = run_hook("gh pr merge 4244", pr_json(["src/lib/isPaying.ts"]), env={"CLAUDE_SKIP_SAFETY": "1"})
        self.assertEqual(result["result"], "allow")


class TestExtractPrRef(unittest.TestCase):
    def test_number(self):
        self.assertEqual(hook.extract_pr_ref("gh pr merge 4244 --squash"), "4244")

    def test_url(self):
        self.assertEqual(hook.extract_pr_ref("gh pr merge https://github.com/2anki/server/pull/4244 --squash"), "4244")

    def test_no_arg_means_current_branch(self):
        self.assertIsNone(hook.extract_pr_ref("gh pr merge --squash --delete-branch"))

    def test_mention_in_quotes_before_the_real_merge_is_ignored(self):
        self.assertEqual(hook.extract_pr_ref('echo "gh pr merge" && gh pr merge 4244'), "4244")


class TestHardRails(unittest.TestCase):
    def test_rail_path_denies_and_names_it(self):
        result = run_hook("gh pr merge 4244", pr_json(["src/lib/isPaying.ts"], comments=[MARKER]))
        self.assertEqual(result["result"], "deny")
        self.assertIn("src/lib/isPaying.ts", result["reason"])
        self.assertIn("hard rail", result["reason"])

    def test_content_trigger_denies(self):
        diff = "+const x = process.env.AUTO_SYNC_PRODUCT_ID;"
        result = run_hook("gh pr merge 4244", pr_json(CLEAN_FILES, comments=[MARKER]), diff_stdout=diff)
        self.assertEqual(result["result"], "deny")
        self.assertIn("AUTO_SYNC_PRODUCT_ID", result["reason"])

    def test_diff_fetch_failure_fails_closed(self):
        result = run_hook("gh pr merge 4244", pr_json(CLEAN_FILES, comments=[MARKER]), diff_fails=True)
        self.assertEqual(result["result"], "deny")
        self.assertIn("could not fetch the PR diff", result["reason"])

    def test_rail_denies_even_when_everything_else_is_green(self):
        result = run_hook("gh pr merge 4244", pr_json(["migrations/20261012_x.js"], comments=[MARKER]))
        self.assertEqual(result["result"], "deny")


class TestReviewMarker(unittest.TestCase):
    def test_marker_in_review_allows(self):
        result = run_hook("gh pr merge 4244", pr_json(CLEAN_FILES, reviews=[f"Looks good\n\n{MARKER}"]))
        self.assertEqual(result["result"], "allow")

    def test_marker_in_comment_allows(self):
        result = run_hook("gh pr merge 4244", pr_json(CLEAN_FILES, comments=[MARKER]))
        self.assertEqual(result["result"], "allow")

    def test_missing_marker_denies(self):
        result = run_hook("gh pr merge 4244", pr_json(CLEAN_FILES))
        self.assertEqual(result["result"], "deny")
        self.assertIn("ship-review", result["reason"])

    def test_marker_for_older_sha_denies_and_says_so(self):
        stale = f"<!-- ship-review: pass sha={OLD} -->"
        result = run_hook("gh pr merge 4244", pr_json(CLEAN_FILES, comments=[stale]))
        self.assertEqual(result["result"], "deny")
        self.assertIn(OLD[:7], result["reason"])
        self.assertIn(HEAD[:7], result["reason"])

    def test_short_sha_marker_is_not_accepted(self):
        short = f"<!-- ship-review: pass sha={HEAD[:12]} -->"
        result = run_hook("gh pr merge 4244", pr_json(CLEAN_FILES, comments=[short]))
        self.assertEqual(result["result"], "deny")

    def test_dependabot_needs_no_marker(self):
        result = run_hook("gh pr merge 4244", pr_json(["pnpm-lock.yaml"], author="dependabot[bot]"))
        self.assertEqual(result["result"], "allow")


class TestSonar(unittest.TestCase):
    def test_sonar_failure_denies_with_reason(self):
        result = run_hook(
            "gh pr merge 4244", pr_json(CLEAN_FILES, comments=[MARKER]),
            sonar=(False, "2 open SonarCloud finding(s) on PR #4244"),
        )
        self.assertEqual(result["result"], "deny")
        self.assertIn("2 open SonarCloud finding(s)", result["reason"])

    def test_sonar_is_checked_for_dependabot_too(self):
        result = run_hook(
            "gh pr merge 4244", pr_json(["pnpm-lock.yaml"], author="dependabot[bot]"),
            sonar=(False, "SonarCloud unreachable"),
        )
        self.assertEqual(result["result"], "deny")


class TestRollup(unittest.TestCase):
    def test_failure_denies(self):
        rollup = GREEN[:-1] + [check("playwright (22.20.0)", conclusion="FAILURE")]
        result = run_hook("gh pr merge 4244", pr_json(CLEAN_FILES, rollup=rollup, comments=[MARKER]))
        self.assertEqual(result["result"], "deny")
        self.assertIn("playwright (22.20.0): FAILURE", result["reason"])

    def test_in_progress_denies(self):
        rollup = GREEN[:-1] + [check("playwright (22.20.0)", conclusion="", status="IN_PROGRESS")]
        result = run_hook("gh pr merge 4244", pr_json(CLEAN_FILES, rollup=rollup, comments=[MARKER]))
        self.assertEqual(result["result"], "deny")

    def test_skipped_test_denies(self):
        rollup = [check("static (22.20.0)"), check("test (22.20.0)", conclusion="SKIPPED")]
        result = run_hook("gh pr merge 4244", pr_json(CLEAN_FILES, rollup=rollup, comments=[MARKER]))
        self.assertEqual(result["result"], "deny")

    def test_dependency_change_without_test_success_denies(self):
        rollup = [check("static (22.20.0)"), check("build (22.20.0)")]
        result = run_hook("gh pr merge 4244", pr_json(["pnpm-lock.yaml"], rollup=rollup, comments=[MARKER]))
        self.assertEqual(result["result"], "deny")
        self.assertIn("pnpm-lock.yaml", result["reason"])


if __name__ == "__main__":
    unittest.main()
