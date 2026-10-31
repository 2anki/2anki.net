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
        "author": {"login": author_login},
        "body": body,
        "files": [{"path": f} for f in files[:GH_PR_VIEW_FILES_CAP]],
    })


DOCS_THEN_WEB_SRC = [f"docs/page{i}.md" for i in range(150)] + ["web/src/App.tsx"]
WEB_SRC_THEN_DOCS = ["web/src/App.tsx"] + [f"docs/page{i}.md" for i in range(150)]
REST_FAILURE = {"returncode": 1, "stdout": "", "stderr": "HTTP 502"}


class TestNonMergeCommand(unittest.TestCase):
    def test_non_gh_command_allows(self):
        result = run_hook("git status")
        self.assertEqual(result["result"], "allow")

    def test_gh_pr_view_allows(self):
        result = run_hook("gh pr view 42")
        self.assertEqual(result["result"], "allow")

    def test_non_bash_tool_allows(self):
        result = run_hook("gh pr merge 42", tool_name="Write")
        self.assertEqual(result["result"], "allow")


class TestDependabotBypass(unittest.TestCase):
    def test_dependabot_author_always_allows(self):
        stdout = make_pr_json("dependabot[bot]", "No browser check", ["web/src/App.tsx"])
        result = run_hook("gh pr merge 42", subprocess_result={"returncode": 0, "stdout": stdout})
        self.assertEqual(result["result"], "allow")


class TestNoWebSrcFiles(unittest.TestCase):
    def test_no_web_src_files_allows(self):
        stdout = make_pr_json("alex", "No browser check", ["src/server.ts", "README.md"])
        result = run_hook("gh pr merge 42", subprocess_result={"returncode": 0, "stdout": stdout})
        self.assertEqual(result["result"], "allow")


class TestChangelogOnlyBypass(unittest.TestCase):
    def test_only_changelog_entry_allows(self):
        stdout = make_pr_json(
            "alex",
            "No browser check",
            ["web/src/pages/WhatsNewPage/changelog/2026-05-21-new-feature.json"],
        )
        result = run_hook("gh pr merge 42", subprocess_result={"returncode": 0, "stdout": stdout})
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
        result = run_hook("gh pr merge 42", subprocess_result={"returncode": 0, "stdout": stdout})
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
        result = run_hook("gh pr merge 42", subprocess_result={"returncode": 0, "stdout": stdout})
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
        result = run_hook("gh pr merge 42", subprocess_result={"returncode": 0, "stdout": stdout})
        self.assertEqual(result["result"], "allow")

    def test_out_clause_allows(self):
        body = "Browser check: not applicable — internal-only, no UI change\n"
        stdout = make_pr_json("alex", body, ["web/src/utils/helpers.ts"])
        result = run_hook("gh pr merge 42", subprocess_result={"returncode": 0, "stdout": stdout})
        self.assertEqual(result["result"], "allow")


class TestAttestationAbsent(unittest.TestCase):
    def test_no_browser_check_section_denies(self):
        body = "## What\nSome feature.\n\n## Testing\n- Unit tests added: yes\n"
        stdout = make_pr_json("alex", body, ["web/src/App.tsx"])
        result = run_hook("gh pr merge 42", subprocess_result={"returncode": 0, "stdout": stdout})
        self.assertEqual(result["result"], "deny")

    def test_one_ticked_one_unticked_denies(self):
        body = "- [x] Golden path on localhost:3000\n- [ ] No console errors at 375px\n"
        stdout = make_pr_json("alex", body, ["web/src/App.tsx"])
        result = run_hook("gh pr merge 42", subprocess_result={"returncode": 0, "stdout": stdout})
        self.assertEqual(result["result"], "deny")


class TestFilesPastTheFirst100(unittest.TestCase):
    def test_web_src_file_past_the_first_100_files_requires_the_attestation(self):
        self.assertGreater(DOCS_THEN_WEB_SRC.index("web/src/App.tsx"), GH_PR_VIEW_FILES_CAP)
        stdout = make_pr_json("alex", "No browser check", DOCS_THEN_WEB_SRC)
        result = run_hook(
            "gh pr merge 42",
            subprocess_result={"returncode": 0, "stdout": stdout},
            rest_paths=DOCS_THEN_WEB_SRC,
        )
        self.assertEqual(result["result"], "deny")

    def test_web_src_file_past_the_first_100_files_with_the_attestation_allows(self):
        body = "- [x] Golden path on localhost:3000\n- [x] No console errors at 375px"
        stdout = make_pr_json("alex", body, DOCS_THEN_WEB_SRC)
        result = run_hook(
            "gh pr merge 42",
            subprocess_result={"returncode": 0, "stdout": stdout},
            rest_paths=DOCS_THEN_WEB_SRC,
        )
        self.assertEqual(result["result"], "allow")

    def test_lists_files_over_rest_for_the_pr_number(self):
        fake = gh_responder({"stdout": make_pr_json("alex", "", ["src/a.ts"])})
        with patch("subprocess.run", side_effect=fake):
            run_hook("gh pr merge 42")
        self.assertEqual(fake.calls[0], ["gh", "pr", "view", "42", "--json", "number,author,body,files"])
        self.assertEqual(fake.calls[1][:4], ["gh", "api", "--paginate", "repos/2anki/2anki.net/pulls/42/files?per_page=100"])

    def test_current_branch_merge_lists_files_for_the_number_gh_pr_view_returned(self):
        fake = gh_responder({"stdout": make_pr_json("alex", "", ["src/a.ts"])})
        with patch("subprocess.run", side_effect=fake):
            run_hook("gh pr merge --squash")
        self.assertEqual(fake.calls[0], ["gh", "pr", "view", "--json", "number,author,body,files"])
        self.assertIn("repos/2anki/2anki.net/pulls/42/files?per_page=100", fake.calls[1])


class TestRestFailure(unittest.TestCase):
    def test_rest_failure_still_gates_web_src_in_the_first_100_files(self):
        stdout = make_pr_json("alex", "No browser check", WEB_SRC_THEN_DOCS)
        result = run_hook(
            "gh pr merge 42",
            subprocess_result={"returncode": 0, "stdout": stdout},
            rest_result=REST_FAILURE,
        )
        self.assertEqual(result["result"], "deny")

    def test_rest_failure_falls_back_to_the_first_100_files_as_before(self):
        stdout = make_pr_json("alex", "No browser check", DOCS_THEN_WEB_SRC)
        result = run_hook(
            "gh pr merge 42",
            subprocess_result={"returncode": 0, "stdout": stdout},
            rest_result=REST_FAILURE,
        )
        self.assertEqual(result["result"], "allow")

    def test_rest_os_error_still_gates_web_src_in_the_first_100_files(self):
        view = MagicMock(returncode=0, stdout=make_pr_json("alex", "x", WEB_SRC_THEN_DOCS), stderr="")
        result = run_hook("gh pr merge 42", subprocess_side_effect=[view, PermissionError("gh")])
        self.assertEqual(result["result"], "deny")


class TestToolingErrors(unittest.TestCase):
    def test_gh_not_found_allows(self):
        result = run_hook(
            "gh pr merge 42",
            subprocess_side_effect=FileNotFoundError("gh not found"),
        )
        self.assertEqual(result["result"], "allow")

    def test_gh_nonzero_exit_allows(self):
        result = run_hook(
            "gh pr merge 42",
            subprocess_result={"returncode": 1, "stdout": "", "stderr": "not found"},
        )
        self.assertEqual(result["result"], "allow")

    def test_gh_timeout_allows(self):
        import subprocess
        result = run_hook(
            "gh pr merge 42",
            subprocess_side_effect=subprocess.TimeoutExpired("gh", 15),
        )
        self.assertEqual(result["result"], "allow")


if __name__ == "__main__":
    unittest.main()
