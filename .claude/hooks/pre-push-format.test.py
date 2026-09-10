#!/usr/bin/env python3
import importlib.util
import json
import os
import sys
import unittest
import unittest.mock
from unittest.mock import patch

HOOKS_DIR = os.path.dirname(os.path.abspath(__file__))
spec = importlib.util.spec_from_file_location(
    "pre_push_format",
    os.path.join(HOOKS_DIR, "pre-push-format.py"),
)
hook = importlib.util.module_from_spec(spec)
spec.loader.exec_module(hook)


def run_hook(
    command,
    tool_name="Bash",
    env=None,
    paths=None,
    oxfmt_result=True,
    subjects=None,
):
    """paths: changed paths (or None = couldn't tell).
    oxfmt_result: True (clean) | str (offending output) | None (couldn't run).
    subjects: commit subjects vs origin/main."""
    subjects = subjects or []
    stdin_data = json.dumps(
        {"tool_name": tool_name, "tool_input": {"command": command}}
    )
    captured = {"oxfmt_called": False}

    def fake_allow():
        captured["result"] = "allow"
        sys.exit(0)

    def fake_deny(reason):
        captured["result"] = "deny"
        captured["reason"] = reason
        sys.exit(0)

    def fake_changed_paths(project_dir):
        return paths

    def fake_run_oxfmt(files, project_dir):
        captured["oxfmt_called"] = True
        captured["oxfmt_files"] = files
        return oxfmt_result

    def fake_subjects(project_dir):
        return subjects

    with patch.object(hook, "allow", side_effect=fake_allow), \
         patch.object(hook, "deny", side_effect=fake_deny), \
         patch.object(hook, "changed_paths", side_effect=fake_changed_paths), \
         patch.object(hook, "run_oxfmt_check", side_effect=fake_run_oxfmt), \
         patch.object(hook, "commit_subjects", side_effect=fake_subjects), \
         patch("sys.stdin") as mock_stdin, \
         patch.dict(os.environ, env or {}, clear=False):
        mock_stdin.read.return_value = stdin_data
        try:
            hook.main()
        except SystemExit:
            pass

    return captured


class TestPassThrough(unittest.TestCase):
    def test_non_bash_tool_allows(self):
        result = run_hook("git push", tool_name="Write")
        self.assertEqual(result["result"], "allow")
        self.assertFalse(result["oxfmt_called"])

    def test_non_push_command_allows(self):
        result = run_hook("git status")
        self.assertEqual(result["result"], "allow")
        self.assertFalse(result["oxfmt_called"])

    def test_push_to_main_allows_without_check(self):
        result = run_hook(
            "git push origin main", paths=["src/server.ts"]
        )
        self.assertEqual(result["result"], "allow")
        self.assertFalse(result["oxfmt_called"])

    def test_env_bypass_allows(self):
        result = run_hook(
            "git push -u origin feat/x",
            env={"CLAUDE_SKIP_FORMAT_CHECK": "1"},
            paths=["web/src/App.tsx"],
            oxfmt_result="web/src/App.tsx has issues",
        )
        self.assertEqual(result["result"], "allow")
        self.assertFalse(result["oxfmt_called"])

    def test_inline_skip_in_command_allows(self):
        result = run_hook(
            "CLAUDE_SKIP_FORMAT_CHECK=1 git push -u origin feat/x",
            paths=["web/src/App.tsx"],
            oxfmt_result="web/src/App.tsx has issues",
        )
        self.assertEqual(result["result"], "allow")
        self.assertFalse(result["oxfmt_called"])

    def test_no_formattable_changes_allows(self):
        result = run_hook(
            "git push -u origin docs/x", paths=["README.md"]
        )
        self.assertEqual(result["result"], "allow")
        self.assertFalse(result["oxfmt_called"])

    def test_couldnt_tell_diff_allows(self):
        result = run_hook("git push -u origin feat/x", paths=None)
        self.assertEqual(result["result"], "allow")
        self.assertFalse(result["oxfmt_called"])


class TestFormatGate(unittest.TestCase):
    def test_clean_changed_files_allow(self):
        result = run_hook(
            "git push -u origin feat/x",
            paths=["src/usecases/Convert.ts"],
            oxfmt_result=True,
        )
        self.assertEqual(result["result"], "allow")
        self.assertTrue(result["oxfmt_called"])
        self.assertEqual(result["oxfmt_files"], ["src/usecases/Convert.ts"])

    def test_format_issue_denies_with_fix_command(self):
        result = run_hook(
            "git push -u origin feat/x",
            paths=["web/src/App.tsx"],
            oxfmt_result="web/src/App.tsx (1ms)\nFormat issues found",
        )
        self.assertEqual(result["result"], "deny")
        self.assertIn("web/src/App.tsx", result["reason"])
        self.assertIn("oxfmt", result["reason"])
        self.assertIn("--write", result["reason"])
        self.assertIn("CLAUDE_SKIP_FORMAT_CHECK=1", result["reason"])

    def test_only_formattable_paths_passed_to_oxfmt(self):
        result = run_hook(
            "git push -u origin feat/x",
            paths=[
                "src/server.ts",
                "README.md",
                "web/src/App.tsx",
                "migrations/x.js",
                "src/templates/note.html",
            ],
            oxfmt_result=True,
        )
        self.assertEqual(result["result"], "allow")
        self.assertEqual(
            result["oxfmt_files"], ["src/server.ts", "web/src/App.tsx"]
        )

    def test_oxfmt_not_runnable_allows_fail_open(self):
        result = run_hook(
            "git push -u origin feat/x",
            paths=["src/server.ts"],
            oxfmt_result=None,
        )
        self.assertEqual(result["result"], "allow")
        self.assertTrue(result["oxfmt_called"])


class TestOxfmtOutputClassification(unittest.TestCase):
    def test_all_files_ignored_by_config_is_clean(self):
        completed = unittest.mock.Mock(
            returncode=2,
            stdout="Checking formatting...\n\nExpected at least one target "
            "file. All matched files may have been excluded by ignore rules.\n",
            stderr="",
        )
        with patch.object(hook.subprocess, "run", return_value=completed):
            result = hook.run_oxfmt_check(
                ["src/data_layer/public/DeckShares.ts"], "/tmp"
            )
        self.assertIs(result, True)

    def test_real_format_diff_is_returned_as_output(self):
        completed = unittest.mock.Mock(
            returncode=1,
            stdout="Checking formatting...\n[warn] src/server.ts\n",
            stderr="",
        )
        with patch.object(hook.subprocess, "run", return_value=completed):
            result = hook.run_oxfmt_check(["src/server.ts"], "/tmp")
        self.assertIn("src/server.ts", result)


class TestFormattableFilter(unittest.TestCase):
    def test_filters_extension_and_root(self):
        kept = hook.formattable([
            "src/a.ts",
            "web/src/b.tsx",
            "src/c.js",
            "web/src/d.jsx",
            "src/e.json",
            "docs/f.ts",
            "web/public/g.ts",
        ])
        self.assertEqual(
            kept,
            ["src/a.ts", "web/src/b.tsx", "src/c.js", "web/src/d.jsx"],
        )


class TestChangelogWarning(unittest.TestCase):
    def test_feat_touching_src_without_changelog_warns(self):
        with patch.object(hook.sys.stderr, "write") as werr:
            with patch.object(hook, "commit_subjects",
                              return_value=["feat: add thing"]):
                hook.warn_changelog_if_missing(["src/usecases/Convert.ts"], ".")
        joined = "".join(c.args[0] for c in werr.call_args_list)
        self.assertIn("no changelog entry", joined)

    def test_changelog_present_does_not_warn(self):
        with patch.object(hook.sys.stderr, "write") as werr:
            with patch.object(hook, "commit_subjects",
                              return_value=["feat: add thing"]):
                hook.warn_changelog_if_missing(
                    [
                        "src/usecases/Convert.ts",
                        "web/src/pages/WhatsNewPage/changelog/2026-06-10-x.json",
                    ],
                    ".",
                )
        self.assertEqual(werr.call_count, 0)

    def test_chore_only_does_not_warn(self):
        with patch.object(hook.sys.stderr, "write") as werr:
            with patch.object(hook, "commit_subjects",
                              return_value=["chore: tooling"]):
                hook.warn_changelog_if_missing(["src/server.ts"], ".")
        self.assertEqual(werr.call_count, 0)

    def test_test_only_source_does_not_warn(self):
        with patch.object(hook.sys.stderr, "write") as werr:
            with patch.object(hook, "commit_subjects",
                              return_value=["fix: bug"]):
                hook.warn_changelog_if_missing(
                    ["src/usecases/Convert.test.ts"], "."
                )
        self.assertEqual(werr.call_count, 0)

    def test_fix_scoped_subject_warns(self):
        with patch.object(hook.sys.stderr, "write") as werr:
            with patch.object(hook, "commit_subjects",
                              return_value=["fix(notion): broken table"]):
                hook.warn_changelog_if_missing(["web/src/App.tsx"], ".")
        joined = "".join(c.args[0] for c in werr.call_args_list)
        self.assertIn("no changelog entry", joined)


if __name__ == "__main__":
    unittest.main()
