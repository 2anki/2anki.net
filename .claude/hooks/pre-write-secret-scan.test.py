#!/usr/bin/env python3
import json
import os
import subprocess
import sys
import unittest

HOOKS_DIR = os.path.dirname(os.path.abspath(__file__))
HOOK = os.path.join(HOOKS_DIR, "pre-write-secret-scan.py")

AWS_KEY_ID = "AKIA" + "Q" * 16
REFUSED_WRITES = (
    {"file_path": "src/data_layer/public/public/Users.ts", "content": "export type Users = {};\n"},
    {"file_path": "src/lib/config.ts", "content": f"const key = '{AWS_KEY_ID}';\n"},
)


def run_hook(tool_input, launch_env=None):
    env = {key: value for key, value in os.environ.items() if key != "CLAUDE_SKIP_SAFETY"}
    env.update(launch_env or {})
    payload = json.dumps({"tool_name": "Write", "tool_input": tool_input})
    result = subprocess.run([sys.executable, HOOK], input=payload, env=env, capture_output=True, text=True)
    return json.loads(result.stdout)


def decision(output):
    return output.get("hookSpecificOutput", {}).get("permissionDecision", "allow")


class SecretScanTest(unittest.TestCase):
    def test_refuses_the_generated_data_layer_and_a_secret(self):
        for tool_input in REFUSED_WRITES:
            self.assertEqual(decision(run_hook(tool_input)), "deny", tool_input["file_path"])

    def test_allows_ordinary_content(self):
        self.assertEqual(run_hook({"file_path": "src/lib/x.ts", "content": "export const x = 1;\n"}), {"continue": True})

    def test_the_launch_time_env_still_bypasses(self):
        for tool_input in REFUSED_WRITES:
            self.assertEqual(run_hook(tool_input, {"CLAUDE_SKIP_SAFETY": "1"}), {"continue": True})

    def test_no_refusal_tells_the_agent_to_bypass(self):
        for tool_input in REFUSED_WRITES:
            refusal = run_hook(tool_input)["hookSpecificOutput"]["permissionDecisionReason"]
            self.assertNotIn("CLAUDE_SKIP_SAFETY", refusal)
            self.assertNotIn("relaunch", refusal.lower())


if __name__ == "__main__":
    unittest.main()
