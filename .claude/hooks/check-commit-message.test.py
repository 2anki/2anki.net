#!/usr/bin/env python3
import json
import os
import subprocess
import sys
import unittest

HOOKS_DIR = os.path.dirname(os.path.abspath(__file__))
HOOK = os.path.join(HOOKS_DIR, "check-commit-message.py")

BAD_COMMIT = 'git commit -m "update docs"'
GOOD_COMMIT = 'git commit -m "docs: explain the ledger" -m "The marker step changed and agents need the new command."'


def run_hook(command, launch_env=None):
    env = {key: value for key, value in os.environ.items() if key != "CLAUDE_SKIP_COMMIT_CHECK"}
    env.update(launch_env or {})
    payload = json.dumps({"tool_name": "Bash", "tool_input": {"command": command}})
    result = subprocess.run([sys.executable, HOOK], input=payload, env=env, capture_output=True, text=True)
    return json.loads(result.stdout)


def decision(output):
    return output.get("hookSpecificOutput", {}).get("permissionDecision", "allow")


class CommitMessageTest(unittest.TestCase):
    def test_refuses_a_message_without_a_prefix_or_body(self):
        self.assertEqual(decision(run_hook(BAD_COMMIT)), "deny")

    def test_allows_a_conventional_message_with_a_why(self):
        self.assertEqual(run_hook(GOOD_COMMIT), {"continue": True})

    def test_the_refusal_does_not_suggest_a_skip_variable(self):
        refusal = run_hook(BAD_COMMIT)["hookSpecificOutput"]["permissionDecisionReason"]
        self.assertNotIn("CLAUDE_SKIP", refusal)
        self.assertNotIn("bypass", refusal.lower())

    def test_an_inline_prefix_does_not_skip_the_check(self):
        self.assertEqual(decision(run_hook("CLAUDE_SKIP_COMMIT_CHECK=1 " + BAD_COMMIT)), "deny")

    def test_the_launch_time_env_still_skips_it(self):
        self.assertEqual(run_hook(BAD_COMMIT, {"CLAUDE_SKIP_COMMIT_CHECK": "1"}), {"continue": True})


if __name__ == "__main__":
    unittest.main()
