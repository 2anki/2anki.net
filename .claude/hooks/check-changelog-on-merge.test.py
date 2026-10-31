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
        "number": 42,
        "url": "https://github.com/2anki/2anki.net/pull/42",
        "author": {"login": author_login},
        "body": body,
        "files": [{"path": f} for f in files[:GH_PR_VIEW_FILES_CAP]],
        "commits": [{"messageHeadline": h} for h in commit_headlines],
    })


def rest_stdout(files):
    return "".join(json.dumps([f, "modified", 1, 1]) + "\n" for f in files)


def gh_responses(author_login, body, files, commit_headlines):
    return [
        {"stdout": make_pr_json(author_login, body, files, commit_headlines)},
        {"stdout": rest_stdout(files)},
    ]


def gh_responses_rest_failed(author_login, body, files, commit_headlines):
    return [
        {"stdout": make_pr_json(author_login, body, files, commit_headlines)},
        REST_FAILURE,
        {"stdout": "".join(f"{f}\n" for f in files)},
    ]


CHANGELOG = "web/src/pages/WhatsNewPage/changelog/2026-06-19-x.json"
CAPPED_SOURCE_FILES = ["src/server.ts"] + [f"src/file{i}.ts" for i in range(150)]
REST_FAILURE = {"returncode": 1, "stdout": "", "stderr": "HTTP 502"}
REST_VIEW_ARGV = ["gh", "api", "--paginate", "repos/2anki/2anki.net/pulls/42/files?per_page=100"]
MERGE = "gh pr merge 42 --repo 2anki/server --squash"
MERGE_CANONICAL = "gh pr merge 42 --repo 2anki/2anki.net --squash"
REJECTED_FORMS = (
    "gh pr merge 42",
    "gh pr merge --squash",
    "gh pr merge some-branch --repo 2anki/server --squash",
    "gh pr merge #42 --repo 2anki/server --squash",
    'gh pr merge "42" --repo 2anki/server --squash',
    "gh pr merge 42 -sR other/repo",
    "gh pr -R other/repo merge 42",
    "gh pr merge 42 --squash --repo 2anki/server; true",
    "gh pr merge 42 --repo other/repo --squash",
    "gh pr merge https://github.com/2anki/server/pull/42 --repo 2anki/server --squash",
    "GH_REPO=other/repo gh pr merge 42 --repo 2anki/server --squash",
    "cd /tmp/other && gh pr merge 42 --repo 2anki/server --squash",
    "gh api -X PUT repos/2anki/2anki.net/pulls/42/merge",
)
DIFF_TOO_LARGE_STDERR = (
    "could not find pull request diff: HTTP 406: Sorry, the diff exceeded "
    "the maximum number of files (300)."
)


class TestPassthrough(unittest.TestCase):
    def test_non_gh_command_allows(self):
        self.assertEqual(run_hook("git status")["result"], "allow")

    def test_gh_pr_view_allows(self):
        self.assertEqual(run_hook("gh pr view 42")["result"], "allow")

    def test_non_bash_tool_allows(self):
        self.assertEqual(run_hook(MERGE, tool_name="Write")["result"], "allow")


class TestExemptions(unittest.TestCase):
    def test_dependabot_allows(self):
        responses = gh_responses("dependabot[bot]", "", ["src/server.ts"], ["fix: bump"])
        self.assertEqual(run_hook(MERGE, subprocess_results=responses)["result"], "allow")

    def test_no_feat_or_fix_commit_allows(self):
        responses = gh_responses("alex", "", ["src/server.ts"], ["chore: tidy", "refactor: rename"])
        self.assertEqual(run_hook(MERGE, subprocess_results=responses)["result"], "allow")

    def test_feat_but_no_source_touched_allows(self):
        responses = gh_responses("alex", "", ["README.md", "docs/x.md"], ["feat: docs only"])
        self.assertEqual(run_hook(MERGE, subprocess_results=responses)["result"], "allow")

    def test_only_test_files_touched_allows(self):
        responses = gh_responses("alex", "", ["src/foo.test.ts"], ["fix: test"])
        self.assertEqual(run_hook(MERGE, subprocess_results=responses)["result"], "allow")

    def test_changelog_entry_present_allows(self):
        responses = gh_responses("alex", "", ["src/server.ts", CHANGELOG], ["feat: thing"])
        self.assertEqual(run_hook(MERGE, subprocess_results=responses)["result"], "allow")

    def test_changelog_entry_past_first_100_files_allows(self):
        files = [f"src/file{i}.ts" for i in range(122)] + [CHANGELOG]
        self.assertGreater(files.index(CHANGELOG), GH_PR_VIEW_FILES_CAP)
        responses = gh_responses("alex", "", files, ["fix: big"])
        self.assertEqual(run_hook(MERGE, subprocess_results=responses)["result"], "allow")

    def test_out_clause_allows(self):
        body = "What: internal refactor.\nno changelog entry — internal only"
        responses = gh_responses("alex", body, ["src/server.ts"], ["fix: internal"])
        self.assertEqual(run_hook(MERGE, subprocess_results=responses)["result"], "allow")


class TestDenies(unittest.TestCase):
    def test_feat_source_no_changelog_no_outclause_denies(self):
        responses = gh_responses("alex", "Just a feature.", ["src/server.ts"], ["feat: thing"])
        self.assertEqual(run_hook(MERGE, subprocess_results=responses)["result"], "deny")

    def test_fix_web_src_denies(self):
        responses = gh_responses("alex", "A fix.", ["web/src/App.tsx"], ["fix: bug"])
        self.assertEqual(run_hook(MERGE, subprocess_results=responses)["result"], "deny")

    def test_source_file_past_first_100_files_denies(self):
        files = [f"docs/page{i}.md" for i in range(120)] + ["src/server.ts"]
        responses = gh_responses("alex", "x", files, ["fix: big"])
        self.assertEqual(run_hook(MERGE, subprocess_results=responses)["result"], "deny")

    def test_scoped_feat_prefix_denies(self):
        responses = gh_responses("alex", "x", ["src/server.ts"], ["feat(parser): thing"])
        self.assertEqual(run_hook(MERGE, subprocess_results=responses)["result"], "deny")


class TestRestFileList(unittest.TestCase):
    def test_a_crafted_name_past_the_first_100_files_is_read_exactly_and_denies(self):
        crafted = "docs/z b/web/src/pages/WhatsNewPage/changelog/2026-06-19-x.json"
        files = [f"src/file{i}.ts" for i in range(120)] + [crafted]
        responses = gh_responses("alex", "x", files, ["fix: big"])
        self.assertEqual(run_hook(MERGE, subprocess_results=responses)["result"], "deny")

    def test_more_than_300_files_with_the_changelog_last_allows(self):
        files = [f"src/file{i}.ts" for i in range(320)] + [CHANGELOG]
        responses = gh_responses("alex", "x", files, ["fix: big"])
        self.assertEqual(run_hook(MERGE, subprocess_results=responses)["result"], "allow")

    def test_a_complete_rest_list_deny_omits_the_100_files_note(self):
        responses = gh_responses("alex", "x", CAPPED_SOURCE_FILES, ["fix: bug"])
        result = run_hook(MERGE, subprocess_results=responses)
        self.assertEqual(result["result"], "deny")
        self.assertNotIn("first 100", result["reason"])


def view_with(url):
    return json.dumps({**json.loads(make_pr_json("alex", "", ["src/server.ts", CHANGELOG], ["fix: x"])), "url": url})


class TestMergeForm(unittest.TestCase):
    def test_every_other_merge_form_is_denied_without_calling_gh(self):
        for command in REJECTED_FORMS:
            with patch("subprocess.run") as run:
                result = run_hook(command)
            self.assertEqual(result["result"], "deny", command)
            self.assertIn("gh pr merge <n> --repo 2anki/server --squash", result["reason"])
            run.assert_not_called()


class TestViewMismatch(unittest.TestCase):
    def test_a_view_resolving_another_repo_is_denied(self):
        result = run_hook(MERGE, subprocess_results=[{"stdout": view_with("https://github.com/someone/fork/pull/42")}])
        self.assertEqual(result["result"], "deny")
        self.assertIn("someone/fork", result["reason"])

    def test_a_view_resolving_another_pr_is_denied(self):
        result = run_hook(MERGE, subprocess_results=[{"stdout": view_with("https://github.com/2anki/2anki.net/pull/7")}])
        self.assertEqual(result["result"], "deny")


class TestFailedView(unittest.TestCase):
    def test_a_failed_view_denies_the_merge(self):
        import subprocess
        for failure in (
            {"subprocess_side_effect": FileNotFoundError("gh")},
            {"subprocess_side_effect": PermissionError("gh")},
            {"subprocess_side_effect": subprocess.TimeoutExpired("gh", 15)},
            {"subprocess_results": [{"returncode": 1, "stdout": ""}]},
            {"subprocess_results": [{"stdout": "not json"}]},
            {"subprocess_results": [{"stdout": "[]"}]},
        ):
            result = run_hook(MERGE, **failure)
            self.assertEqual(result["result"], "deny", failure)
            self.assertIn("could not read PR 42", result["reason"])


class TestRestFailureFallsBackToGhPrDiff(unittest.TestCase):
    def test_changelog_entry_past_first_100_files_allows_through_gh_pr_diff(self):
        files = [f"src/file{i}.ts" for i in range(122)] + [CHANGELOG]
        responses = gh_responses_rest_failed("alex", "", files, ["fix: big"])
        self.assertEqual(run_hook(MERGE, subprocess_results=responses)["result"], "allow")

    def test_source_file_past_first_100_files_denies_through_gh_pr_diff(self):
        files = [f"docs/page{i}.md" for i in range(120)] + ["src/server.ts"]
        responses = gh_responses_rest_failed("alex", "x", files, ["fix: big"])
        self.assertEqual(run_hook(MERGE, subprocess_results=responses)["result"], "deny")

    def test_under_100_view_files_skip_gh_pr_diff_and_still_deny(self):
        view = {"stdout": make_pr_json("alex", "x", ["src/server.ts"], ["fix: bug"])}
        result = run_hook(MERGE, subprocess_results=[view, REST_FAILURE])
        self.assertEqual(result["result"], "deny")
        self.assertNotIn("first 100", result["reason"])

    def test_gh_pr_diff_too_large_falls_back_to_view_files_and_denies(self):
        view = {"stdout": make_pr_json("alex", "x", CAPPED_SOURCE_FILES, ["fix: bug"])}
        too_large = {"returncode": 1, "stdout": "", "stderr": DIFF_TOO_LARGE_STDERR}
        result = run_hook(MERGE, subprocess_results=[view, REST_FAILURE, too_large])
        self.assertEqual(result["result"], "deny")

    def test_gh_pr_diff_failure_says_only_the_first_100_files_were_checked(self):
        view = {"stdout": make_pr_json("alex", "x", CAPPED_SOURCE_FILES, ["fix: bug"])}
        result = run_hook(MERGE,
            subprocess_results=[view, REST_FAILURE, {"returncode": 1, "stdout": ""}],
        )
        self.assertIn("only the first 100 changed files were checked", result["reason"])

    def test_oversized_diff_with_changelog_past_first_100_files_still_denies_as_before(self):
        files = [f"src/file{i}.ts" for i in range(320)] + [CHANGELOG]
        view = {"stdout": make_pr_json("alex", "x", files, ["fix: big"])}
        too_large = {"returncode": 1, "stdout": "", "stderr": DIFF_TOO_LARGE_STDERR}
        result = run_hook(MERGE, subprocess_results=[view, REST_FAILURE, too_large])
        self.assertEqual(result["result"], "deny")

    def test_oversized_diff_with_source_only_past_first_100_files_allows_as_before(self):
        files = [f"docs/page{i}.md" for i in range(320)] + ["src/server.ts"]
        view = {"stdout": make_pr_json("alex", "x", files, ["fix: big"])}
        too_large = {"returncode": 1, "stdout": "", "stderr": DIFF_TOO_LARGE_STDERR}
        result = run_hook(MERGE, subprocess_results=[view, REST_FAILURE, too_large])
        self.assertEqual(result["result"], "allow")

    def test_gh_pr_diff_empty_success_still_sees_view_source_and_denies(self):
        view = {"stdout": make_pr_json("alex", "x", CAPPED_SOURCE_FILES, ["fix: bug"])}
        result = run_hook(MERGE, subprocess_results=[view, REST_FAILURE, {"stdout": ""}])
        self.assertEqual(result["result"], "deny")

    def test_gh_pr_diff_misparsed_name_still_sees_view_source_and_denies(self):
        files = ["src/a b/c.ts"] + [f"docs/page{i}.md" for i in range(150)]
        view = {"stdout": make_pr_json("alex", "x", files, ["fix: bug"])}
        result = run_hook(MERGE, subprocess_results=[view, REST_FAILURE, {"stdout": "c.ts\n"}])
        self.assertEqual(result["result"], "deny")

    def test_rest_os_error_then_gh_missing_on_diff_falls_back_to_view_files_and_denies(self):
        view = MagicMock(returncode=0, stdout=make_pr_json("alex", "x", CAPPED_SOURCE_FILES, ["fix: bug"]), stderr="")
        result = run_hook(MERGE,
            subprocess_side_effect=[view, PermissionError("gh"), FileNotFoundError("gh")],
        )
        self.assertEqual(result["result"], "deny")

    def test_rest_timeout_then_diff_timeout_falls_back_to_view_files_and_denies(self):
        import subprocess
        view = MagicMock(returncode=0, stdout=make_pr_json("alex", "x", CAPPED_SOURCE_FILES, ["fix: bug"]), stderr="")
        result = run_hook(MERGE,
            subprocess_side_effect=[view, subprocess.TimeoutExpired("gh", 20), subprocess.TimeoutExpired("gh", 15)],
        )
        self.assertEqual(result["result"], "deny")


class TestGhCalls(unittest.TestCase):
    def gh_argv(self, command, files=CAPPED_SOURCE_FILES + [CHANGELOG], rest_fails=False):
        responses = gh_responses("alex", "", files, ["feat: thing"])
        if rest_fails:
            responses = gh_responses_rest_failed("alex", "", files, ["feat: thing"])
        mocks = [
            MagicMock(returncode=r.get("returncode", 0), stdout=r["stdout"], stderr=r.get("stderr", ""))
            for r in responses
        ]
        with patch("subprocess.run", side_effect=mocks) as run:
            run_hook(command)
        return [call.args[0] for call in run.call_args_list]

    def test_the_ship_merge_views_with_the_matched_repo_then_lists_files_over_rest(self):
        for command, repo in ((MERGE, "2anki/server"), (MERGE_CANONICAL, "2anki/2anki.net")):
            argv = self.gh_argv(command)
            self.assertEqual(argv[0], ["gh", "pr", "view", "42", "-R", repo, "--json", "number,url,author,body,files,commits"])
            self.assertEqual(argv[1][:4], REST_VIEW_ARGV)
            self.assertEqual(len(argv), 2)

    def test_rest_failure_with_100_view_files_diffs_the_matched_repo(self):
        files = [f"src/file{i}.ts" for i in range(99)] + [CHANGELOG]
        argv = self.gh_argv(MERGE, files=files, rest_fails=True)
        self.assertEqual(argv[2], ["gh", "pr", "diff", "42", "-R", "2anki/server", "--name-only"])

    def test_rest_failure_with_99_view_files_skips_gh_pr_diff(self):
        files = [f"src/file{i}.ts" for i in range(98)] + [CHANGELOG]
        self.assertEqual(len(self.gh_argv(MERGE, files=files, rest_fails=True)), 2)


if __name__ == "__main__":
    unittest.main()
