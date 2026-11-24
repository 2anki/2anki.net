#!/usr/bin/env python3
"""
PreToolUse hook: a `ship-review` pass marker is posted only when the /ship
review ledger (`ship_ledger.py`) backs it.

A marker post is a Bash command that names `gh`, has `review`, `comment` or
`api` as a whole argument, and carries `ship-review: pass sha=<40 hex>` in its own text or in a
file it passes (`--body-file`, `-F`, `--input`, `field=@file`). It must be
exactly the step 2 form,

    gh pr review <n> [--repo 2anki/server|--repo 2anki/2anki.net] --comment --body-file <file>

and, for every SHA its marker names, the ledger for PR <n> must hold:
  * no block for that SHA, or for a SHA whose PR diff has the same patch-id;
  * at least one pass for that SHA, or for a SHA with the same patch-id;
  * for every block recorded for the PR (on an earlier head), a pass of the
    same scope for the marker's change recorded after it.

So a reviewer's BLOCK can no longer be followed by a marker without a second
review of the new head. Nothing else is touched: a review or comment with no
marker, `gh pr create`/`edit` bodies, and every non-`gh` command pass.
Dependabot PRs need no marker (the merge gate exempts them, unchanged); a
marker posted on one is checked like any other.

The ledger is written by the orchestrator, so this binds the operator to a
named record, it does not prove the review ran. A failure inside the hook
denies the marker rather than letting it through.
"""
import json
import os
import re
import shlex
import sys

HOOKS_DIR = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HOOKS_DIR)

import merge_command  # noqa: E402
import ship_ledger  # noqa: E402

POSTING_WORD = re.compile(r"review|comment|api", re.I)
MARKER_SHA = re.compile(r"ship-review:\s*pass\s+sha=([0-9a-fA-F]{40})", re.I)
MARKER_POST = re.compile(
    r"gh pr review ([1-9][0-9]{0,8})(?: --repo (?:2anki/server|2anki/2anki\.net))? --comment --body-file (\S+)(?: 2>&1)?"
)
MARKER_FORM = "gh pr review <n> --repo 2anki/server --comment --body-file <file>"
FILE_FLAGS = ("--body-file", "-F", "--input")
MAX_BODY_BYTES = 1_000_000
RECORD_COMMAND = "python3 .claude/hooks/ship_ledger.py record <n> <full sha> <pass|block> <scope>"


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


def tokens(cmd):
    try:
        return shlex.split(cmd)
    except ValueError:
        return cmd.split()


def referenced_files(cmd):
    found = []
    parts = tokens(cmd)
    for index, part in enumerate(parts):
        if part in FILE_FLAGS and index + 1 < len(parts):
            found.append(parts[index + 1])
            continue
        for flag in FILE_FLAGS:
            if part.startswith(flag + "="):
                found.append(part[len(flag) + 1:])
        if "=@" in part:
            found.append(part.split("=@", 1)[1])
    return found


def read_body(path, cwd):
    resolved = path if os.path.isabs(path) else os.path.join(cwd, path)
    try:
        with open(resolved, "rb") as body:
            return body.read(MAX_BODY_BYTES).decode("utf-8", "replace")
    except OSError:
        return ""


def marker_shas(text):
    return [sha.lower() for sha in MARKER_SHA.findall(text)]


def posted_shas(cmd, cwd):
    texts = [cmd] + [read_body(path, cwd) for path in referenced_files(cmd)]
    shas = []
    for text in texts:
        shas += [sha for sha in marker_shas(text) if sha not in shas]
    return shas


def may_post_a_marker(cmd):
    if not merge_command.GH_WORD.search(cmd):
        return False
    return any(POSTING_WORD.fullmatch(part) for part in tokens(cmd))


def form_violation():
    return (
        "Refusing this command: it posts a `ship-review` pass marker in a form /ship does not use. "
        f"Post the marker exactly as `{MARKER_FORM}` (/ship step 2), with the marker in the file."
    )


def ledger_violation(pr, sha, reason):
    return (
        f"Refusing the ship-review marker for PR {pr} at {sha[:7]}: {reason}. Run the step 2 review "
        f"fan-out on this head and record each reviewer's verdict with `{RECORD_COMMAND}` "
        "(see .claude/commands/ship.md step 2). A block clears only with a new commit and a fresh pass "
        "of the same scope."
    )


def gate(cmd, cwd):
    shas = posted_shas(cmd, cwd)
    if not shas:
        allow()
    match = MARKER_POST.fullmatch(cmd.strip(" \n"))
    if match is None:
        deny(form_violation())
    pr = match.group(1)
    path = ship_ledger.ledger_path(cwd)
    if path is None:
        deny(ledger_violation(pr, shas[0], "the hook could not find this checkout's git dir to read the ledger"))
    entries = ship_ledger.read_entries(path)
    for sha in shas:
        reason = ship_ledger.marker_violation(entries, pr, sha, ship_ledger.patch_id(sha, cwd))
        if reason:
            deny(ledger_violation(pr, sha, reason))
    allow()


def main():
    try:
        data = json.loads(sys.stdin.read())
    except json.JSONDecodeError:
        allow()

    if not isinstance(data, dict) or data.get("tool_name") != "Bash":
        allow()

    cmd = (data.get("tool_input") or {}).get("command", "")
    if not isinstance(cmd, str) or not may_post_a_marker(cmd):
        allow()

    cwd = data.get("cwd") if isinstance(data.get("cwd"), str) else os.getcwd()
    try:
        gate(cmd, cwd)
    except SystemExit:
        raise
    except Exception as exc:
        deny(
            f"Refusing this command: the ship-review ledger check failed ({type(exc).__name__}), and a "
            "failed check does not let a marker through. Run it again."
        )


if __name__ == "__main__":
    main()
