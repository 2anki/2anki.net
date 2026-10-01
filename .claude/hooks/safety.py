#!/usr/bin/env python3
"""
PreToolUse safety hook: blocks foot-gun shell commands.

Currently blocks:
  * git push to main or master (force or not)
  * bare `git push` with no remote+branch — forces explicit branch name
  * git reset --hard when there are uncommitted changes
  * rm -rf against /, ~, $HOME, or parent directories

Bypass: relaunch the session with CLAUDE_SKIP_SAFETY=1 set in the
environment. An inline prefix on the command does NOT work - this hook reads
os.environ before the shell that would apply the assignment ever runs.
"""
import json
import os
import re
import subprocess
import sys


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


PROTECTED_BRANCH = re.compile(r"\b(main|master)\b")
GIT_PUSH = re.compile(r"\bgit\s+push\b")


def push_args(cmd):
    if not GIT_PUSH.search(cmd):
        return None
    after = GIT_PUSH.split(cmd, 1)[1]
    after = re.split(r"[;&|]", after, 1)[0]
    return after


def is_push_to_protected(cmd):
    after = push_args(cmd)
    if after is None:
        return False
    return bool(PROTECTED_BRANCH.search(after))


def is_bare_push(cmd):
    after = push_args(cmd)
    if after is None:
        return False
    non_flags = [t for t in after.split() if not t.startswith("-")]
    return len(non_flags) < 2


def has_uncommitted_changes():
    try:
        result = subprocess.run(
            ["git", "status", "--porcelain"],
            capture_output=True, text=True, timeout=5,
        )
        return bool(result.stdout.strip())
    except Exception:
        return False


def is_reset_hard_with_uncommitted(cmd):
    if "git reset --hard" not in cmd:
        return False
    return has_uncommitted_changes()


RM_FLAGS = re.compile(r"\brm\s+(?:-[rRfvi]+\s+)+")
DANGER_RM_PATTERNS = [
    re.compile(r"\brm\s+(?:-[rRfvi]+\s+)+/(?:\s|$)"),
    re.compile(r"\brm\s+(?:-[rRfvi]+\s+)+~(?:\s|/|$)"),
    re.compile(r"\brm\s+(?:-[rRfvi]+\s+)+\$HOME\b"),
    re.compile(r"\brm\s+(?:-[rRfvi]+\s+)+\.\.(?:\s|/|$)"),
]


def is_dangerous_rm(cmd):
    if not RM_FLAGS.search(cmd):
        return False
    return any(p.search(cmd) for p in DANGER_RM_PATTERNS)


def main():
    if os.environ.get("CLAUDE_SKIP_SAFETY"):
        allow()

    try:
        data = json.loads(sys.stdin.read())
    except json.JSONDecodeError:
        allow()

    if data.get("tool_name") != "Bash":
        allow()

    cmd = data.get("tool_input", {}).get("command", "")

    if is_push_to_protected(cmd):
        deny(
            "Refusing to push to main/master — push to a feature branch and open a PR.\n"
            "If you genuinely need this, relaunch with CLAUDE_SKIP_SAFETY=1 set."
        )

    if is_bare_push(cmd):
        deny(
            "Refusing bare `git push` — always specify the remote and branch explicitly\n"
            "(e.g. `git push origin <branch-name>`) so we never push to main by accident.\n"
            "Bypass by relaunching with CLAUDE_SKIP_SAFETY=1 set."
        )

    if is_reset_hard_with_uncommitted(cmd):
        deny(
            "Refusing `git reset --hard` with uncommitted changes — would discard work.\n"
            "Commit or stash first, or relaunch with CLAUDE_SKIP_SAFETY=1 set."
        )

    if is_dangerous_rm(cmd):
        deny(
            "Refusing `rm -rf` against critical paths (/, ~, $HOME, parent dirs).\n"
            "Relaunch with CLAUDE_SKIP_SAFETY=1 set if intentional."
        )

    allow()


if __name__ == "__main__":
    main()
