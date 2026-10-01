#!/usr/bin/env python3
"""
Caps the length of a PR body an agent writes.

CLAUDE.md says "Report tight ... Alexander reads the diff and PR body, don't
re-narrate them." Nothing enforced that, so on 2026-10-01 a single session
shipped 9,124 words of PR bodies across 13 PRs - a 1,797-word body on a
harness change, 1,102 on a payments guard - plus roughly as much again in chat.
Volume is not rigor. The reader pays for it and so does the clock.

The cap is deliberately generous: a genuinely complex change earns 400 words.
Past that, the detail belongs in the commit body (which travels with the code),
a doc, or an issue.
"""
import json
import re
import sys

WORD_CAP = 400
# Evidence tables are the one thing worth their length, so they do not count.
TABLE_ROW = re.compile(r"^\s*\|.*\|\s*$", re.MULTILINE)
CODE_BLOCK = re.compile(r"```.*?```", re.DOTALL)


def body_from(command):
    match = re.search(r"--body-file[=\s]+(\S+)", command)
    if match:
        try:
            with open(match.group(1).strip("\"'"), encoding="utf-8") as handle:
                return handle.read()
        except OSError:
            return ""
    match = re.search(r"--body[=\s]+(['\"])(.*?)\1", command, re.DOTALL)
    return match.group(2) if match else ""


def prose_words(body):
    stripped = CODE_BLOCK.sub("", body)
    stripped = TABLE_ROW.sub("", stripped)
    return len(stripped.split())


def main():
    try:
        payload = json.load(sys.stdin)
    except (json.JSONDecodeError, ValueError):
        sys.exit(0)
    command = (payload.get("tool_input") or {}).get("command") or ""
    if not re.search(r"\bgh\s+pr\s+(create|edit)\b", command):
        sys.exit(0)

    count = prose_words(body_from(command))
    if count <= WORD_CAP:
        sys.exit(0)

    print(
        f"PR body is {count} words of prose; the cap is {WORD_CAP} "
        "(tables and code blocks are already excluded).\n\n"
        "CLAUDE.md > Working speed: report tight. A long body is not more "
        "rigorous, it just moves the cost onto the reader.\n\n"
        "  Keep:  what changed, why, the evidence, what you are unsure of.\n"
        "  Move:  narrative of how you got there -> commit body.\n"
        "         findings that need their own decision -> an issue.\n"
        "         background that outlives this PR -> a doc.",
        file=sys.stderr,
    )
    sys.exit(2)


if __name__ == "__main__":
    main()
