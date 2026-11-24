#!/usr/bin/env python3
"""
PreToolUse hook: a `ship-review` pass marker is posted only when the /ship
review ledger (`ship_ledger.py`) backs it.

Body-file rule. A command that names `gh` and has `review` or `comment` as an
argument, or names `gh` and `api` and sends a file (`--input`, `field=@file`),
and takes a body from a file (`--body-file`, `-F`, `--input`, `field=@file`)
must be alone in its Bash call and name an existing regular file. Refused,
whether or not the file holds a marker: a `;`, `|`, `&`, `<`, `>` or newline
anywhere (a trailing ` 2>&1` is the one exception); a file that is `-`, under
`/dev/` or `/proc/`, missing, or not a regular file. Otherwise the hook could
read one file while gh posts another (stdin, a file created in the same call,
a path with a `;` stuck to it).

Marker rule. A command of that kind, or any `gh` command with `review`,
`comment` or `api` as an argument, that carries `ship-review: pass
sha=<40 hex>` in its text or file must be exactly the step 2 form,

    gh pr review <n> [--repo 2anki/server|--repo 2anki/2anki.net] --comment --body-file <file>

and, for every SHA its marker names, the ledger for PR <n> must hold:
  * no block for that SHA, or for a SHA whose PR diff has the same patch-id;
  * an `engineering` pass for it, and a `security` pass too when the change
    touches a hard rail or its files could not be read (`ship_ledger.required_scopes`);
  * for every block recorded for the PR, a pass of the same scope for the
    marker's change recorded after it.
A ledger line that does not parse denies, naming the line.

Untouched: a review or comment with an inline body and no marker,
`gh pr create`/`edit` bodies, and every command without `gh`. A short fake SHA
(`sha=abc1234`) in an example is not a marker. Dependabot PRs need no marker
(the merge gate exempts them, unchanged); a marker posted on one is checked
like any other.

The ledger is written by the orchestrator, so this binds the operator to a
named record, it does not prove the review ran. Any unexpected failure,
including a failed import or unreadable input, denies.
"""
import json
import os
import re
import shlex
import sys

HOOKS_DIR = os.path.dirname(os.path.abspath(__file__))

POSTING_WORDS = frozenset({"review", "comment"})
API_WORD = "api"
GH_WORD = re.compile(r"\bgh\b", re.I)
MARKER_SHA = re.compile(r"ship-review:\s*pass\s+sha=([0-9a-fA-F]{40})", re.I)
MARKER_POST = re.compile(
    r"gh pr review ([1-9][0-9]{0,8})(?: --repo (?:2anki/server|2anki/2anki\.net))? --comment --body-file (\S+)(?: 2>&1)?"
)
MARKER_FORM = "gh pr review <n> --repo 2anki/server --comment --body-file <file>"
BODY_FLAGS = ("--body-file", "-F", "--input")
SHELL_CHARACTERS = re.compile(r"[;|&<>\n]")
STDERR_SUFFIX = " 2>&1"
DEVICE_ROOTS = ("/dev/", "/proc/")
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


def value_file(flag, value, is_api):
    if "=@" in value:
        return value.split("=@", 1)[1]
    if flag == "-F" and is_api and "=" in value:
        return None
    return value


def referenced_files(parts, is_api):
    found = []
    for index, part in enumerate(parts):
        if part in BODY_FLAGS:
            if index + 1 < len(parts):
                path = value_file(part, parts[index + 1], is_api)
                if path is not None:
                    found.append(path)
            else:
                found.append("")
            continue
        long_flag = next((flag for flag in BODY_FLAGS if flag.startswith("--") and part.startswith(flag + "=")), None)
        if long_flag:
            found.append(part[len(long_flag) + 1:])
        elif part.startswith("-F") and not part.startswith("--"):
            path = value_file("-F", part[2:], is_api)
            if path is not None:
                found.append(path)
        elif "=@" in part:
            found.append(part.split("=@", 1)[1])
    return found


def resolve(path, cwd):
    return path if os.path.isabs(path) else os.path.join(cwd, path)


def is_device(path):
    return path == "-" or path.startswith(DEVICE_ROOTS) or os.path.realpath(path).startswith(DEVICE_ROOTS)


def body_file_problem(cmd, files, cwd):
    alone = cmd.strip(" \n")
    if alone.endswith(STDERR_SUFFIX):
        alone = alone[: -len(STDERR_SUFFIX)]
    if SHELL_CHARACTERS.search(alone):
        return "it has a `;`, `|`, `&`, `<`, `>` or a newline, so it is not alone in its Bash call"
    for path in files:
        if not path or is_device(path) or is_device(resolve(path, cwd)):
            return f"its body file `{path[:120]}` is stdin or a device, not a file the hook can read"
        if not os.path.isfile(resolve(path, cwd)):
            return f"its body file `{path[:120]}` does not exist or is not a regular file"
    return None


def read_body(path, cwd):
    try:
        with open(resolve(path, cwd), "rb") as body:
            return body.read(MAX_BODY_BYTES).decode("utf-8", "replace")
    except OSError:
        return ""


def marker_shas(texts):
    shas = []
    for content in texts:
        for sha in MARKER_SHA.findall(content):
            if sha.lower() not in shas:
                shas.append(sha.lower())
    return shas


def body_file_violation(problem):
    return (
        f"Refusing this command: it posts a review or comment body from a file, and {problem}. "
        "Write the body with the Write tool, then run the post alone in its own Bash call with "
        f"`--body-file <existing file>`; for the pass marker, exactly `{MARKER_FORM}` (/ship step 2)."
    )


def form_violation():
    return (
        "Refusing this command: it posts a `ship-review` pass marker in a form /ship does not use. "
        f"Post the marker exactly as `{MARKER_FORM}` (/ship step 2), with the marker in the file. "
        "To show the format in prose, use a short fake SHA such as `sha=abc1234`."
    )


def ledger_violation(pr, sha, reason):
    return (
        f"Refusing the ship-review marker for PR {pr} at {sha[:7]}: {reason}. Run the step 2 review "
        f"fan-out on this head and record each reviewer's verdict with `{RECORD_COMMAND}` "
        "(scopes: engineering, security, migration, reach; .claude/commands/ship.md step 2). A block "
        "clears only with a new commit and a fresh pass of the same scope."
    )


def unparsable_ledger_violation(error):
    return (
        f"Refusing the ship-review marker: {error.path} line {error.line_number} does not parse, so the "
        "ledger cannot be read and a block on that line could be missed. Repair that line in place so it "
        "has the six tab-separated fields the record command writes (time, PR, full SHA, pass or block, "
        "one of engineering/security/migration/reach, patch-id or -), keeping its PR, SHA and verdict. "
        "Never delete a line and never turn a block into a pass."
    )


def check_ledger(pr, shas, cwd):
    sys.path.insert(0, HOOKS_DIR)
    import ship_ledger

    path = ship_ledger.ledger_path(cwd)
    if path is None:
        deny(ledger_violation(pr, shas[0], "the hook could not find this checkout's git dir to read the ledger"))
    try:
        entries = ship_ledger.read_entries(path)
    except ship_ledger.LedgerError as error:
        deny(unparsable_ledger_violation(error))
    for sha in shas:
        reason = ship_ledger.marker_violation(
            entries, pr, sha, ship_ledger.patch_id(sha, cwd), ship_ledger.required_scopes(sha, cwd)
        )
        if reason:
            deny(ledger_violation(pr, sha, reason))


def gate(cmd, cwd):
    if not GH_WORD.search(cmd):
        allow()
    parts = tokens(cmd)
    words = {part.lower() for part in parts}
    posts = bool(words & POSTING_WORDS)
    is_api = API_WORD in words and not posts
    if not (posts or is_api):
        allow()
    files = referenced_files(parts, is_api)
    if files:
        problem = body_file_problem(cmd, files, cwd)
        if problem:
            deny(body_file_violation(problem))
    shas = marker_shas([cmd] + [read_body(path, cwd) for path in files])
    if not shas:
        allow()
    match = MARKER_POST.fullmatch(cmd.strip(" \n"))
    if match is None:
        deny(form_violation())
    check_ledger(match.group(1), shas, cwd)
    allow()


def main():
    data = json.loads(sys.stdin.read())
    if not isinstance(data, dict) or data.get("tool_name") != "Bash":
        allow()
    cmd = (data.get("tool_input") or {}).get("command", "")
    if not isinstance(cmd, str):
        allow()
    cwd = data.get("cwd") if isinstance(data.get("cwd"), str) else os.getcwd()
    gate(cmd, cwd)


def guarded_main():
    try:
        main()
    except SystemExit:
        raise
    except BaseException as exc:
        deny(
            f"Refusing this command: the ship-review ledger hook failed ({type(exc).__name__}) before it "
            "could check it, and a failed check does not let a command through. Run it again; if it keeps "
            "failing, fix .claude/hooks/check-ship-review-ledger.py or ship_ledger.py on a branch."
        )


if __name__ == "__main__":
    guarded_main()
