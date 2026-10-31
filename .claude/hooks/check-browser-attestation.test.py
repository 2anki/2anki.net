#!/usr/bin/env python3
import importlib.util
import json
import os
import sys
import unittest
from unittest.mock import patch, MagicMock

HOOKS_DIR = os.path.dirname(os.path.abspath(__file__))
_spec = importlib.util.spec_from_file_location(
    "check_browser_attestation",
    os.path.join(HOOKS_DIR, "check-browser-attestation.py"),
)
hook = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(hook)


def make_input(command, tool_name="Bash"):
    return json.dumps({"tool_name": tool_name, "tool_input": {"command": command}})


GH_PR_VIEW_FILES_CAP = 100


def rest_stdout(paths):
    return "".join(json.dumps([p, "modified", 1, 1]) + "\n" for p in paths)


def view_paths(view_stdout):
    try:
        return [f["path"] for f in json.loads(view_stdout).get("files", [])]
    except (ValueError, AttributeError):
        return []


def gh_responder(view_result, rest_paths=None, rest_result=None):
    calls = []

    def fake_run(args, **kwargs):
        calls.append(args)
        if args[:2] == ["gh", "api"]:
            if rest_result is not None:
                return MagicMock(
                    returncode=rest_result.get("returncode", 0),
                    stdout=rest_result.get("stdout", ""),
                    stderr=rest_result.get("stderr", ""),
                )
            paths = view_paths(view_result.get("stdout", "")) if rest_paths is None else rest_paths
            return MagicMock(returncode=0, stdout=rest_stdout(paths), stderr="")
        return MagicMock(
            returncode=view_result.get("returncode", 0),
            stdout=view_result.get("stdout", ""),
            stderr=view_result.get("stderr", ""),
        )

    fake_run.calls = calls
    return fake_run


def run_hook(
    command,
    tool_name="Bash",
    env=None,
    subprocess_side_effect=None,
    subprocess_result=None,
    rest_paths=None,
    rest_result=None,
):
    env_patch = env or {}
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
    elif subprocess_result is not None:
        run_patcher = patch(
            "subprocess.run",
            side_effect=gh_responder(subprocess_result, rest_paths, rest_result),
        )
    else:
        run_patcher = None

    with patch.object(hook, "allow", side_effect=fake_allow), \
         patch.object(hook, "deny", side_effect=fake_deny), \
         patch("sys.stdin") as mock_stdin, \
         patch.dict(os.environ, env_patch, clear=False):
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


def make_pr_json(author_login, body, files):
    return json.dumps({
        "number": 42,
        "url": "https://github.com/2anki/2anki.net/pull/42",
        "author": {"login": author_login},
        "body": body,
        "files": [{"path": f} for f in files[:GH_PR_VIEW_FILES_CAP]],
    })


DOCS_THEN_WEB_SRC = [f"docs/page{i}.md" for i in range(150)] + ["web/src/App.tsx"]
WEB_SRC_THEN_DOCS = ["web/src/App.tsx"] + [f"docs/page{i}.md" for i in range(150)]
REST_FAILURE = {"returncode": 1, "stdout": "", "stderr": "HTTP 502"}
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
    'gh pr "merge" 42 --repo 2anki/server --squash',
    "gh pr merge 42 --squash --repo 2anki/server; true",
    "gh pr merge 42 --repo 2anki/server) --squash",
    "gh pr merge 42 --repo other/repo --squash",
    "gh pr merge https://github.com/2anki/server/pull/42 --repo 2anki/server --squash",
    "GH_REPO=other/repo gh pr merge 42 --repo 2anki/server --squash",
    "cd /tmp/other && gh pr merge 42 --repo 2anki/server --squash",
    "gh api -X PUT repos/2anki/2anki.net/pulls/42/merge",
    "bash -lc 'gh pr merge 42 --repo 2anki/server --squash'",
    "eval gh pr merge 42 --repo 2anki/server --squash",
    "eval 'gh pr' 'merge 42' '--repo 2anki/server --squash'",
    "gh pr merge 42 --repo 2anki/server --squash > /tmp/out",
    "gh pr merge 42 --repo 2anki/server --squash 2>&1 | tee /tmp/log",
)


class TestNonMergeCommand(unittest.TestCase):
    def test_non_gh_command_allows(self):
        result = run_hook("git status")
        self.assertEqual(result["result"], "allow")

    def test_gh_pr_view_allows(self):
        result = run_hook("gh pr view 42")
        self.assertEqual(result["result"], "allow")

    def test_non_bash_tool_allows(self):
        result = run_hook(MERGE, tool_name="Write")
        self.assertEqual(result["result"], "allow")


class TestDependabotBypass(unittest.TestCase):
    def test_dependabot_bot_login_always_allows(self):
        stdout = make_pr_json("dependabot[bot]", "No browser check", ["web/src/App.tsx"])
        result = run_hook(MERGE, subprocess_result={"returncode": 0, "stdout": stdout})
        self.assertEqual(result["result"], "allow")

    def test_dependabot_app_login_always_allows(self):
        stdout = make_pr_json("app/dependabot", "No browser check", ["web/src/App.tsx"])
        result = run_hook(MERGE, subprocess_result={"returncode": 0, "stdout": stdout})
        self.assertEqual(result["result"], "allow")

    def test_lookalike_login_is_not_exempt(self):
        stdout = make_pr_json("dependabot", "No browser check", ["web/src/App.tsx"])
        result = run_hook(MERGE, subprocess_result={"returncode": 0, "stdout": stdout})
        self.assertEqual(result["result"], "deny")


class TestNoWebSrcFiles(unittest.TestCase):
    def test_no_web_src_files_allows(self):
        stdout = make_pr_json("alex", "No browser check", ["src/server.ts", "README.md"])
        result = run_hook(MERGE, subprocess_result={"returncode": 0, "stdout": stdout})
        self.assertEqual(result["result"], "allow")


class TestChangelogOnlyBypass(unittest.TestCase):
    def test_only_changelog_entry_allows(self):
        stdout = make_pr_json(
            "alex",
            "No browser check",
            ["web/src/pages/WhatsNewPage/changelog/2026-05-21-new-feature.json"],
        )
        result = run_hook(MERGE, subprocess_result={"returncode": 0, "stdout": stdout})
        self.assertEqual(result["result"], "allow")

    def test_multiple_changelog_entries_allow(self):
        stdout = make_pr_json(
            "alex",
            "No browser check",
            [
                "web/src/pages/WhatsNewPage/changelog/2026-05-21-new-feature.json",
                "web/src/pages/WhatsNewPage/changelog/2026-05-21-fix.json",
            ],
        )
        result = run_hook(MERGE, subprocess_result={"returncode": 0, "stdout": stdout})
        self.assertEqual(result["result"], "allow")

    def test_changelog_plus_other_web_src_requires_attestation(self):
        body = "- [x] Golden path on localhost:3000\n- [x] No console errors at 375px"
        stdout = make_pr_json(
            "alex",
            body,
            [
                "web/src/pages/WhatsNewPage/changelog/2026-05-21-new-feature.json",
                "web/src/components/Foo.tsx",
            ],
        )
        result = run_hook(MERGE, subprocess_result={"returncode": 0, "stdout": stdout})
        self.assertEqual(result["result"], "allow")


class TestAttestationPresent(unittest.TestCase):
    def test_both_checkboxes_ticked_allows(self):
        body = (
            "## Browser check\n"
            "- [x] Golden path on localhost:3000\n"
            "- [x] No console errors at 375px\n"
            "Notes:\n"
        )
        stdout = make_pr_json("alex", body, ["web/src/App.tsx"])
        result = run_hook(MERGE, subprocess_result={"returncode": 0, "stdout": stdout})
        self.assertEqual(result["result"], "allow")

    def test_out_clause_allows(self):
        body = "Browser check: not applicable — internal-only, no UI change\n"
        stdout = make_pr_json("alex", body, ["web/src/utils/helpers.ts"])
        result = run_hook(MERGE, subprocess_result={"returncode": 0, "stdout": stdout})
        self.assertEqual(result["result"], "allow")


class TestAttestationAbsent(unittest.TestCase):
    def test_no_browser_check_section_denies(self):
        body = "## What\nSome feature.\n\n## Testing\n- Unit tests added: yes\n"
        stdout = make_pr_json("alex", body, ["web/src/App.tsx"])
        result = run_hook(MERGE, subprocess_result={"returncode": 0, "stdout": stdout})
        self.assertEqual(result["result"], "deny")

    def test_one_ticked_one_unticked_denies(self):
        body = "- [x] Golden path on localhost:3000\n- [ ] No console errors at 375px\n"
        stdout = make_pr_json("alex", body, ["web/src/App.tsx"])
        result = run_hook(MERGE, subprocess_result={"returncode": 0, "stdout": stdout})
        self.assertEqual(result["result"], "deny")


class TestFilesPastTheFirst100(unittest.TestCase):
    def test_web_src_file_past_the_first_100_files_requires_the_attestation(self):
        self.assertGreater(DOCS_THEN_WEB_SRC.index("web/src/App.tsx"), GH_PR_VIEW_FILES_CAP)
        stdout = make_pr_json("alex", "No browser check", DOCS_THEN_WEB_SRC)
        result = run_hook(
            MERGE,
            subprocess_result={"returncode": 0, "stdout": stdout},
            rest_paths=DOCS_THEN_WEB_SRC,
        )
        self.assertEqual(result["result"], "deny")

    def test_web_src_file_past_the_first_100_files_with_the_attestation_allows(self):
        body = "- [x] Golden path on localhost:3000\n- [x] No console errors at 375px"
        stdout = make_pr_json("alex", body, DOCS_THEN_WEB_SRC)
        result = run_hook(
            MERGE,
            subprocess_result={"returncode": 0, "stdout": stdout},
            rest_paths=DOCS_THEN_WEB_SRC,
        )
        self.assertEqual(result["result"], "allow")

    def test_views_with_the_matched_repo_and_lists_files_over_rest(self):
        for command, repo in ((MERGE, "2anki/server"), (MERGE_CANONICAL, "2anki/2anki.net")):
            fake = gh_responder({"stdout": make_pr_json("alex", "", ["src/a.ts"])})
            with patch("subprocess.run", side_effect=fake):
                self.assertEqual(run_hook(command)["result"], "allow")
            self.assertEqual(fake.calls[0], ["gh", "pr", "view", "42", "-R", repo, "--json", "number,url,author,body,files"])
            self.assertEqual(
                fake.calls[1][:4],
                ["gh", "api", "--paginate", "repos/2anki/2anki.net/pulls/42/files?per_page=100"],
            )


class TestMergeForm(unittest.TestCase):
    def test_every_other_merge_form_is_denied_without_calling_gh(self):
        for command in REJECTED_FORMS:
            with patch("subprocess.run", side_effect=AssertionError("no gh call expected")):
                captured = run_hook(command)
            self.assertEqual(captured["result"], "deny", command)
            self.assertIn("gh pr merge <n> --repo 2anki/server --squash", captured["reason"])


def with_url(view_json, url):
    return json.dumps({**json.loads(view_json), "url": url})


class TestViewMismatch(unittest.TestCase):
    def test_a_view_resolving_another_repo_is_denied(self):
        view = with_url(make_pr_json("alex", "", ["src/a.ts"]), "https://github.com/someone/fork/pull/42")
        result = run_hook(MERGE, subprocess_result={"stdout": view})
        self.assertEqual(result["result"], "deny")
        self.assertIn("someone/fork", result["reason"])

    def test_a_view_resolving_another_pr_is_denied(self):
        view = with_url(make_pr_json("alex", "", ["src/a.ts"]), "https://github.com/2anki/2anki.net/pull/43")
        self.assertEqual(run_hook(MERGE, subprocess_result={"stdout": view})["result"], "deny")

    def test_a_view_with_no_url_is_denied(self):
        view = json.dumps({k: v for k, v in json.loads(make_pr_json("alex", "", ["src/a.ts"])).items() if k != "url"})
        self.assertEqual(run_hook(MERGE, subprocess_result={"stdout": view})["result"], "deny")


class TestRestFailure(unittest.TestCase):
    def test_rest_failure_still_gates_web_src_in_the_first_100_files(self):
        stdout = make_pr_json("alex", "No browser check", WEB_SRC_THEN_DOCS)
        result = run_hook(
            MERGE,
            subprocess_result={"returncode": 0, "stdout": stdout},
            rest_result=REST_FAILURE,
        )
        self.assertEqual(result["result"], "deny")

    def test_rest_failure_falls_back_to_the_first_100_files_as_before(self):
        stdout = make_pr_json("alex", "No browser check", DOCS_THEN_WEB_SRC)
        result = run_hook(
            MERGE,
            subprocess_result={"returncode": 0, "stdout": stdout},
            rest_result=REST_FAILURE,
        )
        self.assertEqual(result["result"], "allow")

    def test_rest_os_error_still_gates_web_src_in_the_first_100_files(self):
        view = MagicMock(returncode=0, stdout=make_pr_json("alex", "x", WEB_SRC_THEN_DOCS), stderr="")
        result = run_hook(MERGE, subprocess_side_effect=[view, PermissionError("gh")])
        self.assertEqual(result["result"], "deny")


class TestGateError(unittest.TestCase):
    def test_an_odd_view_shape_denies_instead_of_crashing_open(self):
        view = json.dumps({**json.loads(make_pr_json("alex", "", ["web/src/App.tsx"])), "author": "alex"})
        result = run_hook(MERGE, subprocess_result={"stdout": view})
        self.assertEqual(result["result"], "deny")
        self.assertIn("merge gate failed", result["reason"])


class TestFailedView(unittest.TestCase):
    def test_a_failed_view_denies_the_merge(self):
        import subprocess
        for failure in (
            {"subprocess_side_effect": FileNotFoundError("gh not found")},
            {"subprocess_side_effect": PermissionError("gh")},
            {"subprocess_side_effect": subprocess.TimeoutExpired("gh", 15)},
            {"subprocess_result": {"returncode": 1, "stdout": "", "stderr": "not found"}},
            {"subprocess_result": {"returncode": 0, "stdout": "not json"}},
            {"subprocess_result": {"returncode": 0, "stdout": "[]"}},
        ):
            result = run_hook(MERGE, **failure)
            self.assertEqual(result["result"], "deny", failure)
            self.assertIn("could not read PR 42", result["reason"])


if __name__ == "__main__":
    unittest.main()
