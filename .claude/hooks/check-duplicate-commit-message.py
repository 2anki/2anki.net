#!/usr/bin/env python3
import json
import os
import re
import subprocess
import sys


HEREDOC = re.compile(
    r"<<-?\s*['\"]?(\w+)['\"]?\s*\n(.*?)\n\s*\1\b",
    re.DOTALL,
)
DASH_M_QUOTED = re.compile(r"-m\s+(['\"])(.*?)\1", re.DOTALL)
LONG_FLAG = re.compile(r"--message=(['\"])(.*?)\1", re.DOTALL)

CHORE_DEP_PREFIXES = ("chore(deps):", "chore: bump")


def allow():
    print(json.dumps({"continue": True}))
    sys.exit(0)


def deny(reason):
    print(json.dumps({
        "hookSpecificOutput": {
            "hookEventName": "PreToolUse",
            "permissionDecision": "deny",
            "permissionDecisionReason": reason,
        }
    }))
    sys.exit(0)


def extract_subject(command):
    heredoc = HEREDOC.search(command)
    if heredoc:
        return heredoc.group(2).strip().split("\n")[0].strip()
    plain = DASH_M_QUOTED.search(command)
    if plain:
        return plain.group(2).strip().split("\n")[0].strip()
    eq = LONG_FLAG.search(command)
    if eq:
        return eq.group(2).strip().split("\n")[0].strip()
    return None


def is_chore_dep(subject):
    return any(subject.startswith(p) for p in CHORE_DEP_PREFIXES)


def fetch_recent_log():
    try:
        result = subprocess.run(
            ["git", "log", "--since=24 hours ago", "--pretty=format:%h %ar %s"],
            capture_output=True,
            text=True,
            timeout=10,
        )
        if result.returncode != 0:
            return []
        return [line for line in result.stdout.splitlines() if line.strip()]
    except (subprocess.TimeoutExpired, FileNotFoundError):
        return []


def find_duplicate(subject, log_lines):
    for line in log_lines:
        parts = line.split(" ", 1)
        if len(parts) < 2:
            continue
        sha = parts[0]
        rest = parts[1]
        ago_match = re.match(r"^((?:\d+ \w+ ago)|(?:an? \w+ ago))\s+(.*)", rest)
        if ago_match:
            relative_time = ago_match.group(1)
            log_subject = ago_match.group(2).strip()
        else:
            relative_time = ""
            log_subject = rest.strip()
        if log_subject == subject:
            return sha, relative_time, log_subject
    return None


def main():
    if os.environ.get("CLAUDE_SKIP_COMMIT_DUP_CHECK"):
        allow()

    try:
        data = json.loads(sys.stdin.read())
    except json.JSONDecodeError:
        allow()

    if data.get("tool_name") != "Bash":
        allow()

    command = data.get("tool_input", {}).get("command", "")

    if "git commit" not in command:
        allow()

    if any(flag in command for flag in ["--amend", "--no-edit", "--fixup", "--squash"]):
        allow()

    subject = extract_subject(command)
    if subject is None:
        allow()

    if is_chore_dep(subject):
        allow()

    log_lines = fetch_recent_log()
    match = find_duplicate(subject, log_lines)
    if match is None:
        allow()

    sha, relative_time, matched_subject = match
    truncated = matched_subject[:72]
    time_part = f" ({relative_time})" if relative_time else ""
    deny(
        f"Warning: this commit message was used in the last 24h.\n"
        f'  Previous: {sha} "{truncated}"{time_part}\n'
        f"Say what this commit changes that the earlier one did not, and commit with that message."
    )


if __name__ == "__main__":
    main()
