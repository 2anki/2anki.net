#!/usr/bin/env python3
import importlib.util
import json
import os
import sys
import unittest
from unittest.mock import patch, MagicMock

HOOKS_DIR = os.path.dirname(os.path.abspath(__file__))
_spec = importlib.util.spec_from_file_location(
    "check_changelog_on_merge",
    os.path.join(HOOKS_DIR, "check-changelog-on-merge.py"),
)
hook = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(hook)


def make_input(command, tool_name="Bash"):
    return json.dumps({"tool_name": tool_name, "tool_input": {"command": command}})


def run_hook(command, tool_name="Bash", subprocess_side_effect=None, subprocess_results=None):
    stdin_data = make_input(command, tool_name)
    captured = {}

    def fake_allow():
        captured["result"] = "allow"
        sys.exit(0)

    def fake_deny(reason):
        captured["result"] = "deny"
        captured["reason"] = reason
        sys.exit(0)

    if subprocess_side_effect is not None:
        run_patcher = patch("subprocess.run", side_effect=subprocess_side_effect)
    elif subprocess_results is not None:
        run_patcher = patch("subprocess.run", side_effect=[
            MagicMock(
                returncode=r.get("returncode", 0),
                stdout=r.get("stdout", ""),
                stderr=r.get("stderr", ""),
            )
            for r in subprocess_results
        ])
    else:
        run_patcher = None

    with patch.object(hook, "allow", side_effect=fake_allow), \
         patch.object(hook, "deny", side_effect=fake_deny), \
         patch("sys.stdin") as mock_stdin:
        mock_stdin.read.return_value = stdin_data
        if run_patcher is not None:
            with run_patcher:
                try:
                    hook.main()
                except SystemExit:
                    pass
        else:
            try:
                hook.main()
            except SystemExit:
                pass

    return captured


GH_PR_VIEW_FILES_CAP = 100


def make_pr_json(author_login, body, files, commit_headlines):
    return json.dumps({
        "author": {"login": author_login},
        "body": body,
        "files": [{"path": f} for f in files[:GH_PR_VIEW_FILES_CAP]],
        "commits": [{"messageHeadline": h} for h in commit_headlines],
    })


def gh_responses(author_login, body, files, commit_headlines):
    return [
        {"stdout": make_pr_json(author_login, body, files, commit_headlines)},
        {"stdout": "".join(f"{f}\n" for f in files)},
    ]


CHANGELOG = "web/src/pages/WhatsNewPage/changelog/2026-06-19-x.json"


class TestPassthrough(unittest.TestCase):
    def test_non_gh_command_allows(self):
        self.assertEqual(run_hook("git status")["result"], "allow")

    def test_gh_pr_view_allows(self):
        self.assertEqual(run_hook("gh pr view 42")["result"], "allow")

    def test_non_bash_tool_allows(self):
        self.assertEqual(run_hook("gh pr merge 42", tool_name="Write")["result"], "allow")


class TestExemptions(unittest.TestCase):
    def test_dependabot_allows(self):
        responses = gh_responses("dependabot[bot]", "", ["src/server.ts"], ["fix: bump"])
        self.assertEqual(run_hook("gh pr merge 42", subprocess_results=responses)["result"], "allow")

    def test_no_feat_or_fix_commit_allows(self):
        responses = gh_responses("alex", "", ["src/server.ts"], ["chore: tidy", "refactor: rename"])
        self.assertEqual(run_hook("gh pr merge 42", subprocess_results=responses)["result"], "allow")

    def test_feat_but_no_source_touched_allows(self):
        responses = gh_responses("alex", "", ["README.md", "docs/x.md"], ["feat: docs only"])
        self.assertEqual(run_hook("gh pr merge 42", subprocess_results=responses)["result"], "allow")

    def test_only_test_files_touched_allows(self):
        responses = gh_responses("alex", "", ["src/foo.test.ts"], ["fix: test"])
        self.assertEqual(run_hook("gh pr merge 42", subprocess_results=responses)["result"], "allow")

    def test_changelog_entry_present_allows(self):
        responses = gh_responses("alex", "", ["src/server.ts", CHANGELOG], ["feat: thing"])
        self.assertEqual(run_hook("gh pr merge 42", subprocess_results=responses)["result"], "allow")

    def test_changelog_entry_past_first_100_files_allows(self):
        files = [f"src/file{i}.ts" for i in range(122)] + [CHANGELOG]
        self.assertGreater(files.index(CHANGELOG), GH_PR_VIEW_FILES_CAP)
        responses = gh_responses("alex", "", files, ["fix: big"])
        self.assertEqual(run_hook("gh pr merge 42", subprocess_results=responses)["result"], "allow")

    def test_out_clause_allows(self):
        body = "What: internal refactor.\nno changelog entry — internal only"
        responses = gh_responses("alex", body, ["src/server.ts"], ["fix: internal"])
        self.assertEqual(run_hook("gh pr merge 42", subprocess_results=responses)["result"], "allow")


class TestDenies(unittest.TestCase):
    def test_feat_source_no_changelog_no_outclause_denies(self):
        responses = gh_responses("alex", "Just a feature.", ["src/server.ts"], ["feat: thing"])
        self.assertEqual(run_hook("gh pr merge 42", subprocess_results=responses)["result"], "deny")

    def test_fix_web_src_denies(self):
        responses = gh_responses("alex", "A fix.", ["web/src/App.tsx"], ["fix: bug"])
        self.assertEqual(run_hook("gh pr merge 42", subprocess_results=responses)["result"], "deny")

    def test_more_than_100_files_without_changelog_denies(self):
        files = [f"src/file{i}.ts" for i in range(150)]
        responses = gh_responses("alex", "x", files, ["fix: big"])
        self.assertEqual(run_hook("gh pr merge 42", subprocess_results=responses)["result"], "deny")

    def test_scoped_feat_prefix_denies(self):
        responses = gh_responses("alex", "x", ["src/server.ts"], ["feat(parser): thing"])
        self.assertEqual(run_hook("gh pr merge 42", subprocess_results=responses)["result"], "deny")


class TestToolingErrors(unittest.TestCase):
    def test_gh_not_found_allows(self):
        result = run_hook("gh pr merge 42", subprocess_side_effect=FileNotFoundError("gh"))
        self.assertEqual(result["result"], "allow")

    def test_gh_nonzero_exit_allows(self):
        result = run_hook("gh pr merge 42", subprocess_results=[{"returncode": 1, "stdout": ""}])
        self.assertEqual(result["result"], "allow")

    def test_gh_pr_diff_nonzero_exit_allows(self):
        view = {"stdout": make_pr_json("alex", "x", ["src/server.ts"], ["fix: bug"])}
        result = run_hook("gh pr merge 42", subprocess_results=[view, {"returncode": 1, "stdout": ""}])
        self.assertEqual(result["result"], "allow")

    def test_gh_pr_diff_timeout_allows(self):
        import subprocess
        view = MagicMock(returncode=0, stdout=make_pr_json("alex", "x", ["src/server.ts"], ["fix: bug"]), stderr="")
        result = run_hook(
            "gh pr merge 42",
            subprocess_side_effect=[view, subprocess.TimeoutExpired("gh", 15)],
        )
        self.assertEqual(result["result"], "allow")

    def test_gh_timeout_allows(self):
        import subprocess
        result = run_hook("gh pr merge 42", subprocess_side_effect=subprocess.TimeoutExpired("gh", 15))
        self.assertEqual(result["result"], "allow")


class TestGhCalls(unittest.TestCase):
    def test_paths_come_from_gh_pr_diff_name_only(self):
        responses = gh_responses("alex", "", ["src/server.ts", CHANGELOG], ["feat: thing"])
        mocks = [MagicMock(returncode=0, stdout=r["stdout"], stderr="") for r in responses]
        with patch("subprocess.run", side_effect=mocks) as run:
            result = run_hook("gh pr merge 42")
        self.assertEqual(result["result"], "allow")
        self.assertEqual(run.call_args_list[1].args[0], ["gh", "pr", "diff", "42", "--name-only"])


if __name__ == "__main__":
    unittest.main()
