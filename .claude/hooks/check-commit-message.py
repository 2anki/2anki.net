#!/usr/bin/env python3
"""
PreToolUse hook: block git commits that don't document the change.

Cheap heuristics (no LLM call, no length gates so good short commits
aren't punished for being concise):
  * Subject must use a conventional-commit prefix.
  * Body must exist — at least one non-empty, non-trailer line below
    the subject. Length and prose quality are the human's call.

CLAUDE_SKIP_COMMIT_CHECK is read only from the environment the session was
launched with; an inline `CLAUDE_SKIP_COMMIT_CHECK=1 git commit ...` prefix
does nothing, and the refusal does not suggest it.
"""
import json
import os
import re
import sys


CONVENTIONAL_PREFIX = re.compile(
    r"^(feat|fix|chore|refactor|test|docs|perf|ci|build|style|revert)(\(.+?\))?!?:\s+\S",
)
TRAILER_LINE = re.compile(
    r"^(Co-Authored-By|Co-authored-by|Signed-off-by|Refs|Closes|Fixes|Reviewed-by|See-also):\s",
    re.IGNORECASE,
)
HEREDOC = re.compile(
    r"<<-?\s*['\"]?(\w+)['\"]?\s*\n(.*?)\n\s*\1\b",
    re.DOTALL,
)
DASH_M_QUOTED = re.compile(r"-m\s+(['\"])(.*?)\1", re.DOTALL)
LONG_FLAG = re.compile(r"--message=(['\"])(.*?)\1", re.DOTALL)

SUBJECT_MAX_LEN = 72
BODY_MIN_LEN = 40


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


def commit_heredoc_message(command):
    # A heredoc is the commit message only when it actually feeds `git commit`
    # (e.g. `git commit -F- <<EOF`), not when it writes a file (`cat > x <<EOF`)
    # or supplies an unrelated body (`gh pr create` with a here-doc).
    for match in HEREDOC.finditer(command):
        line_start = command.rfind("\n", 0, match.start()) + 1
        prefix = command[line_start:match.start()]
        if "git commit" in prefix and ">" not in prefix and "tee" not in prefix:
            return match.group(2)
    return None


def extract_message(command):
    # Join every -m: git treats the first as the subject and each subsequent
    # one as a body paragraph, so the hook must read them all (not just -m #1).
    dash_m = DASH_M_QUOTED.findall(command)
    if dash_m:
        return "\n\n".join(value for _quote, value in dash_m)
    eq = LONG_FLAG.search(command)
    if eq:
        return eq.group(2)
    return None


def main():
    if os.environ.get("CLAUDE_SKIP_COMMIT_CHECK"):
        allow()

    try:
        data = json.loads(sys.stdin.read())
    except json.JSONDecodeError:
        allow()

    if data.get("tool_name") != "Bash":
        allow()

    command = data.get("tool_input", {}).get("command", "")

    # A heredoc feeding `git commit` is the message; otherwise strip heredoc
    # bodies so unrelated content (a changelog being written, a PR body that
    # merely mentions committing, example -m flags in prose) can't be mistaken
    # for the command structure or the message.
    message = commit_heredoc_message(command)
    if message is None:
        stripped = HEREDOC.sub("", command)

        if "git commit" not in stripped:
            allow()

        if any(flag in stripped for flag in ["--amend", "--no-edit", "--squash", "--fixup"]):
            allow()

        message = extract_message(stripped)

    if message is None:
        allow()

    lines = message.strip().split("\n")
    subject = lines[0].strip()
    body_lines = lines[1:]

    real_body_lines = [
        line for line in body_lines
        if line.strip() and not TRAILER_LINE.match(line.strip())
    ]
    real_body = "\n".join(real_body_lines).strip()

    errors = []

    if not CONVENTIONAL_PREFIX.match(subject):
        errors.append(
            "Subject must start with a conventional-commit prefix "
            "(feat:, fix:, chore:, refactor:, test:, docs:, perf:, ci:, build:, style:, revert:)."
        )

    if len(subject) > SUBJECT_MAX_LEN:
        errors.append(
            "Subject is " + str(len(subject)) +
            " chars; keep it <= " + str(SUBJECT_MAX_LEN) + "."
        )

    if len(real_body) < BODY_MIN_LEN:
        errors.append(
            "Body must explain WHY this change is needed (motivation, context, constraint). "
            "Got " + str(len(real_body)) + " chars of non-trailer body, need at least "
            + str(BODY_MIN_LEN) + ". The diff already shows WHAT; the body should add WHY."
        )

    if errors:
        deny(
            "Commit message quality check failed:\n  - "
            + "\n  - ".join(errors)
            + "\n\nRewrite the message and retry."
        )

    allow()


if __name__ == "__main__":
    main()
