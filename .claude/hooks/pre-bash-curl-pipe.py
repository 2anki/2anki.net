#!/usr/bin/env python3
"""
PreToolUse → Bash: refuse `curl ... | sh|bash`-style pipes.

The repo's safety.py already blocks pushes to main and bare `git push`;
this complements it with a deterministic check for arbitrary-code-execution
download patterns.

CLAUDE_SKIP_SAFETY is honored only when set in the environment the session
was launched with (by Alexander, in his own shell). An inline prefix on the
command is ignored: this hook reads os.environ before the shell that would
apply the assignment ever runs (.claude/docs/autonomous-shipping.md).
"""
import json
import os
import re
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


# curl|wget piped into a shell, in either order, with optional flags between.
PIPE_TO_SHELL = re.compile(
    r"\b(curl|wget|fetch)\b[^|;&]*\|\s*(sudo\s+)?(sh|bash|zsh|ksh|dash|python\d?|node|ruby|perl)\b",
    re.IGNORECASE,
)
# Same idea but written as `bash <(curl ...)` process substitution.
PROCSUB_SHELL = re.compile(
    r"\b(sh|bash|zsh|ksh|dash|python\d?|node|ruby|perl)\b\s+<\(\s*(curl|wget|fetch)\b",
    re.IGNORECASE,
)


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

    if PIPE_TO_SHELL.search(cmd) or PROCSUB_SHELL.search(cmd):
        deny(
            "Refusing curl|wget piped into a shell/interpreter — that pattern\n"
            "is arbitrary-code-execution against an unverified network response.\n"
            "Download to a file, inspect (and ideally checksum), then run the file."
        )

    allow()


if __name__ == "__main__":
    main()
