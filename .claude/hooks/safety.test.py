#!/usr/bin/env python3
import json
import os
import subprocess
import sys
import unittest

HOOKS_DIR = os.path.dirname(os.path.abspath(__file__))
HOOK = os.path.join(HOOKS_DIR, "safety.py")

REFUSED = (
    "git push origin main",
    "git push",
    "rm -rf ~",
)


def run_hook(command, launch_env=None):
    env = {key: value for key, value in os.environ.items() if key != "CLAUDE_SKIP_SAFETY"}
    env.update(launch_env or {})
    payload = json.dumps({"tool_name": "Bash", "tool_input": {"command": command}})
    result = subprocess.run([sys.executable, HOOK], input=payload, env=env, capture_output=True, text=True)
    return json.loads(result.stdout)


def decision(output):
    return output.get("hookSpecificOutput", {}).get("permissionDecision", "allow")


class InlinePrefixTest(unittest.TestCase):
    def test_an_inline_skip_safety_prefix_does_not_bypass(self):
        for command in REFUSED:
            output = run_hook("CLAUDE_SKIP_SAFETY=1 " + command)
            self.assertEqual(decision(output), "deny", command)

    def test_the_launch_time_env_still_bypasses(self):
        for command in REFUSED:
            self.assertEqual(run_hook(command, {"CLAUDE_SKIP_SAFETY": "1"}), {"continue": True}, command)


class RefusalTextTest(unittest.TestCase):
    def test_no_refusal_tells_the_agent_to_bypass(self):
        for command in REFUSED:
            output = run_hook(command)
            self.assertEqual(decision(output), "deny", command)
            refusal = output["hookSpecificOutput"]["permissionDecisionReason"]
            self.assertNotIn("CLAUDE_SKIP_SAFETY", refusal)
            self.assertNotIn("relaunch", refusal.lower())
            self.assertNotIn("bypass", refusal.lower())


if __name__ == "__main__":
    unittest.main()
