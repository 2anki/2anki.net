#!/usr/bin/env python3
import importlib.util
import json
import os
import sys
import unittest
from unittest.mock import patch, MagicMock

HOOKS_DIR = os.path.dirname(os.path.abspath(__file__))
spec = importlib.util.spec_from_file_location(
    "check_duplicate_commit_message",
    os.path.join(HOOKS_DIR, "check-duplicate-commit-message.py"),
)
hook = importlib.util.module_from_spec(spec)
spec.loader.exec_module(hook)


def make_input(command, tool_name="Bash"):
    return json.dumps({"tool_name": tool_name, "tool_input": {"command": command}})


def run_hook(command, tool_name="Bash", env=None, git_log_output=""):
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

    def fake_subprocess_run(args, **kwargs):
        mock = MagicMock()
        mock.returncode = 0
        mock.stdout = git_log_output
        mock.stderr = ""
        return mock

    with patch.object(hook, "allow", side_effect=fake_allow), \
         patch.object(hook, "deny", side_effect=fake_deny), \
         patch("subprocess.run", side_effect=fake_subprocess_run), \
         patch("sys.stdin") as mock_stdin, \
         patch.dict(os.environ, env_patch, clear=False):
        mock_stdin.read.return_value = stdin_data
        try:
            hook.main()
        except SystemExit:
            pass

    return captured


class TestNonCommitCommands(unittest.TestCase):
    def test_git_status_allows(self):
        result = run_hook("git status")
        self.assertEqual(result["result"], "allow")

    def test_git_push_allows(self):
        result = run_hook("git push origin main")
        self.assertEqual(result["result"], "allow")

    def test_non_bash_tool_allows(self):
        result = run_hook('git commit -m "feat: something"', tool_name="Write")
        self.assertEqual(result["result"], "allow")


class TestCommitFlagBypasses(unittest.TestCase):
    def test_amend_allows(self):
        result = run_hook("git commit --amend --no-edit")
        self.assertEqual(result["result"], "allow")

    def test_no_edit_allows(self):
        result = run_hook("git commit --no-edit")
        self.assertEqual(result["result"], "allow")

    def test_fixup_allows(self):
        result = run_hook("git commit --fixup abc1234")
        self.assertEqual(result["result"], "allow")

    def test_squash_allows(self):
        result = run_hook("git commit --squash abc1234")
        self.assertEqual(result["result"], "allow")


class TestEnvVarBypass(unittest.TestCase):
    def test_skip_env_var_allows(self):
        result = run_hook(
            'git commit -m "feat: something"',
            env={"CLAUDE_SKIP_COMMIT_DUP_CHECK": "1"},
        )
        self.assertEqual(result["result"], "allow")


class TestUniqueMessage(unittest.TestCase):
    def test_unique_message_allows(self):
        log_output = (
            "abc1234 43 minutes ago feat: something else\n"
            "def5678 2 hours ago chore: update deps\n"
        )
        result = run_hook(
            'git commit -m "feat: brand new feature\n\nWhy: we need it."',
            git_log_output=log_output,
        )
        self.assertEqual(result["result"], "allow")

    def test_empty_log_allows(self):
        result = run_hook(
            'git commit -m "feat: first commit\n\nWhy: clean slate."',
            git_log_output="",
        )
        self.assertEqual(result["result"], "allow")


class TestDuplicateMessage(unittest.TestCase):
    def test_duplicate_within_24h_denies(self):
        log_output = "abc1234 43 minutes ago feat: add caching layer\n"
        result = run_hook(
            'git commit -m "feat: add caching layer\n\nWhy: performance."',
            git_log_output=log_output,
        )
        self.assertEqual(result["result"], "deny")
        self.assertIn("abc1234", result["reason"])
        self.assertIn("43 minutes ago", result["reason"])
        self.assertNotIn("CLAUDE_SKIP_COMMIT_DUP_CHECK", result["reason"])

    def test_duplicate_deny_message_format(self):
        log_output = "a1b2c3d 2 hours ago fix: handle null pointer\n"
        result = run_hook(
            'git commit -m "fix: handle null pointer\n\nWhy: crash on empty input."',
            git_log_output=log_output,
        )
        self.assertIn("Warning: this commit message was used in the last 24h", result["reason"])
        self.assertIn("Previous:", result["reason"])
        self.assertIn("Say what this commit changes that the earlier one did not", result["reason"])

    def test_same_subject_different_body_denies(self):
        log_output = "abc1234 1 hour ago feat: update user profile\n"
        result = run_hook(
            'git commit -m "feat: update user profile\n\nWhy: different reason this time."',
            git_log_output=log_output,
        )
        self.assertEqual(result["result"], "deny")


class TestChoreDepsBypass(unittest.TestCase):
    def test_chore_deps_bump_allows(self):
        log_output = "abc1234 30 minutes ago chore(deps): bump lodash from 4.17.20 to 4.17.21\n"
        result = run_hook(
            'git commit -m "chore(deps): bump lodash from 4.17.20 to 4.17.21\n\nBumped by dependabot."',
            git_log_output=log_output,
        )
        self.assertEqual(result["result"], "allow")

    def test_chore_bump_allows(self):
        log_output = "abc1234 30 minutes ago chore: bump node version\n"
        result = run_hook(
            'git commit -m "chore: bump node version\n\nUpdating to latest LTS."',
            git_log_output=log_output,
        )
        self.assertEqual(result["result"], "allow")


if __name__ == "__main__":
    unittest.main()
