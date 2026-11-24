#!/usr/bin/env python3
"""
PreToolUse hook: early feedback on a `ship-review` pass marker. The real
enforcement is at merge time: `check-merge-status.py` refuses a merge whose
head the ledger does not back, whoever posted the marker and however. This
hook only tells the orchestrator sooner, and cannot see a marker posted by a
script or interpreter calling gh, through `xargs`, or from a file changed
after the check.

Alias rule. `gh alias set`/`import` and `gh extension install`/`create` are
refused: they define a gh command under a name no hook reads.

Body-file rule. Any `gh` command that takes a body from a file
(`--body-file`, `-F <path>`, `--input`, `field=@file`; `-F key=value` is a
field, not a file) must be alone in its Bash call and name an existing
regular file. Refused, whether or not the file holds a marker: a `;`, `|`,
`&`, `<`, `>` or newline anywhere (a trailing ` 2>&1` is the one exception);
a file that is `-`, under `/dev/` or `/proc/`, missing, or not a regular file.

Marker rule. A `gh` command with `review`, `comment` or `api` as an argument
that carries `ship-review: pass sha=<40 hex>` in its raw text, its shell
tokens joined, its text with quotes removed, or its body file must be exactly
the step 2 form,

    gh pr review <n> [--repo 2anki/server|--repo 2anki/2anki.net] --comment --body-file <file>

and `ship_ledger.head_violation` must pass for PR <n> at every SHA it names
(required scopes, no unanswered block, verbatim patch-id carry-over, the
exact-revert rule, a ledger that parses).

Untouched: a review or comment with an inline body and no marker, a marker in
a `gh pr create`/`edit` body (the merge gate never reads the PR body), and
every command without `gh`. A short fake SHA
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

MARKER_WORDS = frozenset({"review", "comment", "api"})
ALIAS_ACTIONS = frozenset({"set", "import"})
EXTENSION_WORDS = frozenset({"extension", "extensions", "ext"})
EXTENSION_ACTIONS = frozenset({"install", "create"})
UNQUOTE = re.compile(r"[\"'\\]")
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


def value_file(flag, value):
    if "=@" in value:
        return value.split("=@", 1)[1]
    if flag == "-F" and "=" in value:
        return None
    return value


def referenced_files(parts):
    found = []
    for index, part in enumerate(parts):
        if part in BODY_FLAGS:
            if index + 1 < len(parts):
                path = value_file(part, parts[index + 1])
                if path is not None:
                    found.append(path)
            else:
                found.append("")
            continue
        long_flag = next((flag for flag in BODY_FLAGS if flag.startswith("--") and part.startswith(flag + "=")), None)
        if long_flag:
            found.append(part[len(long_flag) + 1:])
        elif part.startswith("-F") and not part.startswith("--"):
            path = value_file("-F", part[2:])
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


def searchable_texts(cmd, parts):
    return [cmd, " ".join(parts), "".join(parts), UNQUOTE.sub("", cmd)]


def marker_shas(texts):
    shas = []
    for content in texts:
        for sha in MARKER_SHA.findall(content):
            if sha.lower() not in shas:
                shas.append(sha.lower())
    return shas


def body_file_violation(problem):
    return (
        f"Refusing this command: it gives gh a body from a file, and {problem}. "
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


def alias_violation():
    return (
        "Refusing this command: `gh alias set`/`import` and `gh extension install`/`create` define a gh "
        "command under a name no hook reads, so it could post a marker or land a PR unseen. Run the gh "
        "command itself, written out in full; an alias or extension Alexander wants he adds in his own shell."
    )


def is_gh_program(part):
    return part == "gh" or part.endswith("/gh")


def defines_a_command(parts):
    lowered = [part.lower() for part in parts]
    for index, part in enumerate(lowered[:-2]):
        if not is_gh_program(part):
            continue
        subcommand, action = lowered[index + 1], lowered[index + 2]
        if subcommand == "alias" and action in ALIAS_ACTIONS:
            return True
        if subcommand in EXTENSION_WORDS and action in EXTENSION_ACTIONS:
            return True
    return False


def check_ledger(pr, shas, cwd):
    sys.path.insert(0, HOOKS_DIR)
    import ship_ledger

    for sha in shas:
        reason = ship_ledger.head_violation(pr, sha, cwd)
        if reason:
            deny(ledger_violation(pr, sha, reason))


def gate(cmd, cwd):
    if not GH_WORD.search(cmd):
        allow()
    parts = tokens(cmd)
    words = {part.lower() for part in parts}
    if defines_a_command(parts):
        deny(alias_violation())
    files = referenced_files(parts)
    if files:
        problem = body_file_problem(cmd, files, cwd)
        if problem:
            deny(body_file_violation(problem))
    if not words & MARKER_WORDS:
        allow()
    shas = marker_shas(searchable_texts(cmd, parts) + [read_body(path, cwd) for path in files])
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
