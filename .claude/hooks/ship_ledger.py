#!/usr/bin/env python3
"""
The /ship review ledger: one line per reviewer verdict, kept per machine at
`<git common dir>/ship-review-ledger`, next to `ship-deploy.lock`, so it is
shared by every worktree and never committed.

Record a verdict (run from the checkout root, one call per reviewer):

    python3 .claude/hooks/ship_ledger.py record <pr> <full sha> <pass|block> <scope>

`check-ship-review-ledger.py` reads it before the pass marker is posted
(.claude/commands/ship.md step 2). The ledger is append-only; the orchestrator
writes it, so a false line is still possible. The point is that skipping a
second review after a block now takes a false line in a named file rather than
a silently skipped step.

Each line is tab-separated: UTC time, PR number, SHA, verdict, scope, and the
`git patch-id --stable` of the PR's diff against its merge base with
`origin/main` (`-` when it could not be computed). Two SHAs with the same
patch-id carry the same change, which is how a rebase that did not change the
patch keeps its review.
"""
import datetime
import os
import re
import subprocess
import sys

LEDGER_NAME = "ship-review-ledger"
VERDICTS = ("pass", "block")
PR_NUMBER = re.compile(r"[1-9][0-9]{0,8}")
FULL_SHA = re.compile(r"[0-9a-f]{40}")
SCOPE = re.compile(r"[a-z][a-z0-9-]{0,39}")
PATCH_ID = re.compile(r"[0-9a-f]{40}")
NO_PATCH_ID = "-"
BASE_REF = "origin/main"
GIT_TIMEOUT_SECONDS = 30
USAGE = "usage: python3 .claude/hooks/ship_ledger.py record <pr> <full sha> <pass|block> <scope>"


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


def ledger_path(cwd):
    output = run_git(["rev-parse", "--path-format=absolute", "--git-common-dir"], cwd)
    if output is None:
        return None
    common_dir = output.decode("utf-8", "replace").strip()
    return os.path.join(common_dir, LEDGER_NAME) if common_dir else None


def patch_id(sha, cwd):
    base = run_git(["merge-base", BASE_REF, sha], cwd)
    if base is None:
        return None
    base_sha = base.decode("utf-8", "replace").strip()
    diff = run_git(["diff", "--no-ext-diff", "--no-textconv", "--no-color", "--no-renames", base_sha, sha], cwd)
    if not diff:
        return None
    output = run_git(["patch-id", "--stable"], cwd, stdin=diff)
    if output is None:
        return None
    fields = output.decode("utf-8", "replace").split()
    if fields and PATCH_ID.fullmatch(fields[0]):
        return fields[0]
    return None


def parse_line(line):
    fields = line.rstrip("\n").split("\t")
    if len(fields) != 6:
        return None
    _, pr, sha, verdict, scope, patch = fields
    if not (PR_NUMBER.fullmatch(pr) and FULL_SHA.fullmatch(sha) and verdict in VERDICTS and SCOPE.fullmatch(scope)):
        return None
    return Entry(pr, sha, verdict, scope, patch if PATCH_ID.fullmatch(patch) else None)


def read_entries(path):
    try:
        with open(path, encoding="utf-8", errors="replace") as ledger:
            lines = ledger.readlines()
    except FileNotFoundError:
        return []
    parsed = [parse_line(line) for line in lines if line.strip()]
    return [entry for entry in parsed if entry is not None]


def format_line(pr, sha, verdict, scope, patch, now):
    return "\t".join([now, pr, sha, verdict, scope, patch or NO_PATCH_ID]) + "\n"


def marker_violation(entries, pr, sha, patch):
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
    if not passes:
        return f"no pass recorded for PR {pr} at {short} (or a SHA with the same patch)"
    for index, entry in enumerate(mine):
        if entry.verdict != "block":
            continue
        if not any(later > index and mine[later].scope == entry.scope for later in passes):
            return (
                f"the ledger records a `{entry.scope}` block for {entry.sha[:7]} and no `{entry.scope}` pass "
                f"for {short} recorded after it; the fix needs a fresh `{entry.scope}` review"
            )
    return None


def validation_error(pr, sha, verdict, scope):
    if not PR_NUMBER.fullmatch(pr):
        return f"PR number {pr!r} is not a number"
    if not FULL_SHA.fullmatch(sha):
        return f"SHA {sha!r} is not a full 40-character lowercase SHA"
    if verdict not in VERDICTS:
        return f"verdict {verdict!r} is not pass or block"
    if not SCOPE.fullmatch(scope):
        return f"scope {scope!r} must be lowercase letters, digits and dashes (security, engineering, ux-voice, reach)"
    return None


def record(pr, sha, verdict, scope, cwd, now):
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
        sys.stdout.write("no patch-id (SHA not local or empty diff): only this exact SHA counts\n")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
