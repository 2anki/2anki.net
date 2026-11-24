#!/usr/bin/env python3
"""
The /ship review ledger: one line per reviewer verdict, kept per machine at
`<git common dir>/ship-review-ledger`, next to `ship-deploy.lock`, so it is
shared by every worktree and never committed.

Record a verdict (run from the checkout root, one call per reviewer):

    python3 .claude/hooks/ship_ledger.py record <pr> <full sha> <pass|block> <scope>

The scope is one of `engineering`, `security`, `migration`, `reach` (trimmed
and lowercased); any other label is refused. `check-ship-review-ledger.py`
reads the ledger before the pass marker is posted (.claude/commands/ship.md
step 2). The ledger is append-only; the orchestrator writes it, so a false
line is still possible. The point is that skipping a second review after a
block now takes a false line in a named file rather than a silently skipped
step.

Each line is tab-separated: UTC time, PR number, SHA, verdict, scope, and the
`git patch-id --verbatim` of the PR's diff against its merge base with
`origin/main` (`-` when it could not be computed). `--verbatim` keeps
whitespace, so two SHAs share a patch-id only when their diffs match byte for
byte, which is how a rebase that did not change the patch keeps its review.
It needs git 2.39 or later; on an older git no patch-id is computed and only
the exact SHA counts (never `--stable`, which ignores whitespace and would let
a pass carry to an indentation change).

A marker for a change needs an `engineering` pass, plus a `security` pass when
the change touches a hard rail (`hard_rails.py` on the changed files and the
diff) or when the change could not be read.
"""
import datetime
import os
import re
import subprocess
import sys

HOOKS_DIR = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HOOKS_DIR)

import hard_rails  # noqa: E402

LEDGER_NAME = "ship-review-ledger"
VERDICTS = ("pass", "block")
SCOPES = ("engineering", "security", "migration", "reach")
BASE_SCOPES = ("engineering",)
RAIL_SCOPES = ("engineering", "security")
PR_NUMBER = re.compile(r"[1-9][0-9]{0,8}")
FULL_SHA = re.compile(r"[0-9a-f]{40}")
PATCH_ID = re.compile(r"[0-9a-f]{40}")
GIT_VERSION = re.compile(r"git version (\d+)\.(\d+)")
VERBATIM_MIN_GIT = (2, 39)
NO_PATCH_ID = "-"
BASE_REF = "origin/main"
GIT_TIMEOUT_SECONDS = 30
USAGE = (
    "usage: python3 .claude/hooks/ship_ledger.py record <pr> <full sha> <pass|block> "
    "<engineering|security|migration|reach>"
)


class LedgerError(Exception):
    def __init__(self, path, line_number):
        super().__init__(f"{path} line {line_number} does not parse")
        self.path = path
        self.line_number = line_number


class Entry:
    def __init__(self, pr, sha, verdict, scope, patch_id):
        self.pr = pr
        self.sha = sha
        self.verdict = verdict
        self.scope = scope
        self.patch_id = patch_id

    def same_change(self, sha, patch_id):
        if self.sha == sha:
            return True
        return patch_id is not None and self.patch_id == patch_id


def run_git(args, cwd, stdin=None):
    try:
        result = subprocess.run(
            ["git", *args],
            cwd=cwd,
            input=stdin,
            capture_output=True,
            timeout=GIT_TIMEOUT_SECONDS,
        )
    except (subprocess.TimeoutExpired, OSError):
        return None
    if result.returncode != 0:
        return None
    return result.stdout


def text(output):
    return output.decode("utf-8", "replace").strip()


def git_version(cwd):
    output = run_git(["--version"], cwd)
    if output is None:
        return None
    match = GIT_VERSION.match(text(output))
    return (int(match.group(1)), int(match.group(2))) if match else None


def supports_verbatim(version):
    return version is not None and version >= VERBATIM_MIN_GIT


def ledger_path(cwd):
    output = run_git(["rev-parse", "--path-format=absolute", "--git-common-dir"], cwd)
    if output is None:
        return None
    common_dir = text(output)
    return os.path.join(common_dir, LEDGER_NAME) if common_dir else None


def merge_base(sha, cwd):
    output = run_git(["merge-base", BASE_REF, sha], cwd)
    return text(output) if output else None


def pr_diff(base, sha, cwd):
    return run_git(["diff", "--no-ext-diff", "--no-textconv", "--no-color", "--no-renames", base, sha], cwd)


def patch_id(sha, cwd):
    if not supports_verbatim(git_version(cwd)):
        return None
    base = merge_base(sha, cwd)
    if base is None:
        return None
    diff = pr_diff(base, sha, cwd)
    if not diff:
        return None
    output = run_git(["patch-id", "--verbatim"], cwd, stdin=diff)
    if output is None:
        return None
    fields = text(output).split()
    if fields and PATCH_ID.fullmatch(fields[0]):
        return fields[0]
    return None


def changed_files(sha, cwd):
    base = merge_base(sha, cwd)
    if base is None:
        return None
    names = run_git(["-c", "core.quotePath=false", "diff", "--no-renames", "--name-only", base, sha], cwd)
    diff = pr_diff(base, sha, cwd)
    if names is None or diff is None:
        return None
    return text(names).splitlines(), diff.decode("utf-8", "replace")


def required_scopes(sha, cwd):
    change = changed_files(sha, cwd)
    if change is None:
        return RAIL_SCOPES
    paths, diff = change
    if hard_rails.rail_paths(paths) or hard_rails.rail_content_hits(diff):
        return RAIL_SCOPES
    return BASE_SCOPES


def parse_line(line):
    fields = line.rstrip("\n").split("\t")
    if len(fields) != 6:
        return None
    _, pr, sha, verdict, scope, patch = fields
    if not (PR_NUMBER.fullmatch(pr) and FULL_SHA.fullmatch(sha) and verdict in VERDICTS and scope in SCOPES):
        return None
    if patch != NO_PATCH_ID and not PATCH_ID.fullmatch(patch):
        return None
    return Entry(pr, sha, verdict, scope, None if patch == NO_PATCH_ID else patch)


def read_entries(path):
    try:
        with open(path, encoding="utf-8") as ledger:
            lines = ledger.readlines()
    except FileNotFoundError:
        return []
    entries = []
    for number, line in enumerate(lines, start=1):
        if not line.strip():
            continue
        entry = parse_line(line)
        if entry is None:
            raise LedgerError(path, number)
        entries.append(entry)
    return entries


def format_line(pr, sha, verdict, scope, patch, now):
    return "\t".join([now, pr, sha, verdict, scope, patch or NO_PATCH_ID]) + "\n"


def marker_violation(entries, pr, sha, patch, required):
    """None when the ledger lets a pass marker for `sha` on PR `pr` be posted, else the reason."""
    mine = [entry for entry in entries if entry.pr == pr]
    short = sha[:7]
    for entry in mine:
        if entry.verdict == "block" and entry.same_change(sha, patch):
            return (
                f"the ledger records a `{entry.scope}` block for {entry.sha[:7]}, which carries the same "
                f"change as {short}; a block clears only with a new commit that changes the patch and a "
                "fresh review of that commit"
            )
    passes = [index for index, entry in enumerate(mine) if entry.verdict == "pass" and entry.same_change(sha, patch)]
    for scope in required:
        if not any(mine[index].scope == scope for index in passes):
            return (
                f"no `{scope}` pass recorded for PR {pr} at {short} (or a SHA with the same patch); this "
                f"change needs a pass from each of: {', '.join(required)}"
            )
    for index, entry in enumerate(mine):
        if entry.verdict != "block":
            continue
        if not any(later > index and mine[later].scope == entry.scope for later in passes):
            return (
                f"the ledger records a `{entry.scope}` block for {entry.sha[:7]} and no `{entry.scope}` pass "
                f"for {short} recorded after it; the fix needs a fresh `{entry.scope}` review"
            )
    return None


def normalise_scope(scope):
    return scope.strip().lower()


def validation_error(pr, sha, verdict, scope):
    if not PR_NUMBER.fullmatch(pr):
        return f"PR number {pr!r} is not a number"
    if not FULL_SHA.fullmatch(sha):
        return f"SHA {sha!r} is not a full 40-character SHA"
    if verdict not in VERDICTS:
        return f"verdict {verdict!r} is not pass or block"
    if scope not in SCOPES:
        return f"scope {scope!r} is not one of {', '.join(SCOPES)}"
    return None


def record(pr, sha, verdict, scope, cwd, now):
    pr, sha, verdict, scope = pr.strip(), sha.strip().lower(), verdict.strip().lower(), normalise_scope(scope)
    error = validation_error(pr, sha, verdict, scope)
    if error:
        raise ValueError(error)
    path = ledger_path(cwd)
    if path is None:
        raise ValueError("not inside a git checkout; run this from the repository root")
    line = format_line(pr, sha, verdict, scope, patch_id(sha, cwd), now)
    with open(path, "a", encoding="utf-8") as ledger:
        ledger.write(line)
    return path, line


def utc_now():
    return datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def main(argv):
    if len(argv) != 6 or argv[1] != "record":
        sys.stderr.write(USAGE + "\n")
        return 2
    _, _, pr, sha, verdict, scope = argv
    try:
        path, line = record(pr, sha, verdict, scope, os.getcwd(), utc_now())
    except ValueError as exc:
        sys.stderr.write(f"[ship_ledger] {exc}\n{USAGE}\n")
        return 2
    sys.stdout.write(f"recorded in {path}: {line}")
    if line.rstrip("\n").endswith("\t" + NO_PATCH_ID):
        sys.stdout.write("no patch-id (SHA not local, empty diff, or git older than 2.39): only this exact SHA counts\n")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
