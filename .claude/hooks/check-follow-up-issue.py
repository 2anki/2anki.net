#!/usr/bin/env python3
"""
Blocks a GitHub issue whose title is a read or an owner step.

Adoption reviews, metric reads and steps only Alexander can do go in the
private Follow-ups project, not in a public issue (CLAUDE.md > Git, and
.claude/docs/follow-ups-project.md). The repo is public and those issues carry
business numbers. The prose rule alone did not hold: `Needs you` issues were
banned on 2026-10-05 and three were still open on 2026-10-27, next to 15
review and read issues, all moved to the project that day.

Matching is on the title only, against the shapes those 18 issues used. Real
work (a bug, a feature, a code change a read decided on) passes, and so does
any title with a code-work prefix (`fix:`, `docs:`, ...), so an issue about
the review rules themselves can still be filed. `chore:` gets no pass: an
agent once filed "chore: run the pause-offer adoption review" as a chore.
"""
import json
import re
import sys

BLOCKED_TITLES = [
    (re.compile(r"^\s*needs you\b", re.IGNORECASE), "an owner step (`Needs you`)"),
    (re.compile(r"^\s*decide\s*:", re.IGNORECASE), "an owner decision"),
    (re.compile(r"\badoption review\b", re.IGNORECASE), "an adoption review"),
    (re.compile(r"\bT\+\d+", re.IGNORECASE), "a T+N review"),
    (re.compile(r"^\s*review\s*:", re.IGNORECASE), "a review"),
    (re.compile(r"\bread\s*\((by\s+|next read\s+)?\d{4}-\d{2}-\d{2}", re.IGNORECASE), "a dated metric read"),
    (re.compile(r"\bkeep\s*(or|/)\s*(remove|revert|kill)\b", re.IGNORECASE), "a keep-or-remove verdict"),
]

CODE_WORK_PREFIX = re.compile(r"^\s*(feat|fix|docs|refactor|perf|test|ci|build|revert)(\([^)]*\))?!?\s*:", re.IGNORECASE)

FIELD_FLAG = r"(?:-[fF]|--field|--raw-field)(?:=|\s+)"

QUOTED = r"(['\"])(.*?)\1"


def title_from(command):
    if re.search(r"\bgh\s+issue\s+create\b", command):
        match = re.search(r"(?:--title|-t)(?:=|\s+)" + QUOTED, command, re.DOTALL)
        return match.group(2) if match else None
    if re.search(r"\bgh\s+api\b.*\brepos/[^/\s]+/[^/\s]+/issues(?:\s|$|['\"])", command):
        quoted_value = re.search(FIELD_FLAG + r"title=" + QUOTED, command, re.DOTALL)
        if quoted_value:
            return quoted_value.group(2)
        quoted_field = re.search(FIELD_FLAG + r"(['\"])title=(.*?)\1", command, re.DOTALL)
        if quoted_field:
            return quoted_field.group(2)
        bare = re.search(FIELD_FLAG + r"title=(\S+)", command)
        return bare.group(1) if bare else None
    return None


def blocked_reason(title):
    if CODE_WORK_PREFIX.search(title):
        return None
    for pattern, kind in BLOCKED_TITLES:
        if pattern.search(title):
            return kind
    return None


def main():
    try:
        payload = json.load(sys.stdin)
    except (json.JSONDecodeError, ValueError):
        sys.exit(0)
    tool_input = payload.get("tool_input") if isinstance(payload, dict) else None
    command = tool_input.get("command") if isinstance(tool_input, dict) else None
    if not isinstance(command, str):
        sys.exit(0)
    title = title_from(command)
    if title is None:
        sys.exit(0)
    kind = blocked_reason(title)
    if kind is None:
        sys.exit(0)

    print(
        f'Issue title "{title}" reads as {kind}. Reads, reviews and owner-only '
        "steps are never public GitHub issues: the repo is public and they "
        "carry business numbers.\n\n"
        "Add a draft item to the private Follow-ups project instead "
        "(https://github.com/orgs/Laer-Smart/projects/4) with Status, Area, "
        "Owner and, when dated, Due. Recipe: .claude/docs/follow-ups-project.md.\n\n"
        "If this really is code work (a bug, a feature, a change a read decided "
        "on), retitle it as the work with a code-work prefix, e.g. `fix: ...` or `feat: ...` (`chore:` does not pass).",
        file=sys.stderr,
    )
    sys.exit(2)


if __name__ == "__main__":
    main()
