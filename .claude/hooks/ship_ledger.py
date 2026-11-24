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

A head needs an `engineering` pass, plus `security` when the change touches a
hard rail (`hard_rails.py` on the changed files and the diff), `migration`
when a path starts with `migrations/` or `src/data_layer/public/`, and
`reach` when the diff touches `src/` or `web/src/` and a commit subject in
`<merge-base>..<sha>` is feat/fix/perf/refactor (or the subjects cannot be
read). When the change itself cannot be read, all four are required.

Exact revert: when the verbatim patch-id of `<merge-base>..<sha>` equals that
of `git diff M M^` for one of the last 20 first-parent commits M of
`origin/main`, and no changed path is under `migrations/`, no scope is
required; a recorded block that no later same-scope pass answers still
refuses. Git computes this; there is no label to claim. A re-land is not a
revert: when the PR's patch-id also equals the forward patch of any
first-parent commit in the whole history of the PR's changed paths (one
streamed `git log -p` into `git patch-id --verbatim`; a revert of a revert
brings back a change that was rolled back), the normal scopes apply. Any git
error or a timeout counts as a re-land. The PR title
counts as a subject for `reach` when the caller passes it (the merge gate
does; the marker hook cannot read it without a network call).

`head_violation` is the one check, used by `check-ship-review-ledger.py` when
a marker is posted and by `check-merge-status.py` at merge time.
"""
import contextlib
import datetime
import os
import re
import subprocess
import sys
import time

HOOKS_DIR = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HOOKS_DIR)

import hard_rails  # noqa: E402

LEDGER_NAME = "ship-review-ledger"
VERDICTS = ("pass", "block")
SCOPES = ("engineering", "security", "migration", "reach")
BASE_SCOPES = ("engineering",)
MIGRATION_ROOTS = ("migrations/", "src/data_layer/public/")
REACH_ROOTS = ("src/", "web/src/")
REACH_SUBJECT = re.compile(r"^(feat|fix|perf|refactor)(\([^)]*\))?!?:", re.IGNORECASE)
REVERT_WINDOW = 20
RELAND_TIMEOUT_SECONDS = 25
PINNED_GIT_CONFIG = (
    "diff.relative=false",
    "diff.noprefix=false",
    "diff.mnemonicPrefix=false",
    "diff.renames=false",
    "core.quotePath=false",
    "diff.algorithm=myers",
    "diff.context=3",
    "diff.interHunkContext=0",
    "diff.indentHeuristic=true",
    "diff.suppressBlankEmpty=false",
    "diff.submodule=short",
    "log.follow=false",
    "log.showSignature=false",
)
UNSET_GIT_ENV = ("GIT_DIFF_OPTS", "GIT_EXTERNAL_DIFF", "GIT_DIFF_PATH_COUNTER", "GIT_DIFF_PATH_TOTAL")
RELAND_LOG_ARGS = (
    "log", "-O/dev/null", "--first-parent", "--diff-merges=first-parent", "--full-diff", "-p",
    "--no-ext-diff", "--no-textconv", "--no-color", "--no-renames", "--format=commit %H",
)
REVERT_EXCLUDED_ROOT = "migrations/"
PR_NUMBER = re.compile(r"[1-9][0-9]{0,8}")
FULL_SHA = re.compile(r"[0-9a-f]{40}")
PATCH_ID = re.compile(r"[0-9a-f]{40}")
GIT_VERSION = re.compile(r"git version (\d+)\.(\d+)")
VERBATIM_MIN_GIT = (2, 39)
NO_PATCH_ID = "-"
BASE_REF = "origin/main"
GIT_TIMEOUT_SECONDS = 30
CHECK_BUDGET_SECONDS = 15
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


class Budget:
    deadline = None


def seconds_left(cap):
    if Budget.deadline is None:
        return cap
    return min(cap, Budget.deadline - time.monotonic())


@contextlib.contextmanager
def check_budget(seconds):
    previous = Budget.deadline
    Budget.deadline = time.monotonic() + seconds
    try:
        yield
    finally:
        Budget.deadline = previous


def git_command(args):
    pinned = [part for setting in PINNED_GIT_CONFIG for part in ("-c", setting)]
    return ["git", *pinned, *args]


def git_env():
    return {key: value for key, value in os.environ.items() if key not in UNSET_GIT_ENV}


def run_git(args, cwd, stdin=None):
    timeout = seconds_left(GIT_TIMEOUT_SECONDS)
    if timeout <= 0:
        return None
    try:
        result = subprocess.run(
            git_command(args),
            cwd=cwd,
            env=git_env(),
            input=stdin,
            capture_output=True,
            timeout=timeout,
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


def toplevel(cwd):
    output = run_git(["rev-parse", "--show-toplevel"], cwd)
    if output is None:
        return None
    root = os.fsdecode(output.rstrip(b"\n"))
    return root or None


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
    return run_git(
        [
            "diff", "--no-relative", "-O/dev/null", "--no-ext-diff", "--no-textconv", "--no-color", "--no-renames",
            base, sha,
        ],
        cwd,
    )


def verbatim_patch_id(diff, cwd):
    if not diff:
        return None
    output = run_git(["patch-id", "--verbatim"], cwd, stdin=diff)
    if output is None:
        return None
    fields = text(output).split()
    if fields and PATCH_ID.fullmatch(fields[0]):
        return fields[0]
    return None


def patch_id(sha, cwd):
    if not supports_verbatim(git_version(cwd)):
        return None
    base = merge_base(sha, cwd)
    if base is None:
        return None
    return verbatim_patch_id(pr_diff(base, sha, cwd), cwd)


def changed_names(base, sha, cwd):
    """Every path changed between `base` and `sha`, byte-exact: NUL-separated, never stripped or C-quoted."""
    names = run_git(["diff", "--no-relative", "--no-renames", "--name-only", "-z", base, sha], cwd)
    if names is None:
        return None
    return [os.fsdecode(name) for name in names.split(b"\0") if name]


def commit_subjects(base, sha, cwd):
    output = run_git(["log", "--format=%s", f"{base}..{sha}"], cwd)
    return None if output is None else text(output).splitlines()


def read_change(sha, cwd):
    base = merge_base(sha, cwd)
    if base is None:
        return None
    paths = changed_names(base, sha, cwd)
    diff = pr_diff(base, sha, cwd)
    if paths is None or diff is None:
        return None
    return paths, diff.decode("utf-8", "replace"), commit_subjects(base, sha, cwd)


def needs_reach(paths, subjects):
    if not any(path.startswith(REACH_ROOTS) for path in paths):
        return False
    if subjects is None:
        return True
    return any(REACH_SUBJECT.match(subject.strip()) for subject in subjects)


def required_scopes(sha, cwd, extra_subjects=(), extra_paths=()):
    change = read_change(sha, cwd)
    if change is None:
        return SCOPES
    local_paths, diff, subjects = change
    paths = local_paths + [path for path in extra_paths if isinstance(path, str) and path not in local_paths]
    if subjects is not None:
        subjects = subjects + [subject for subject in extra_subjects if isinstance(subject, str)]
    scopes = list(BASE_SCOPES)
    if hard_rails.rail_paths(paths) or hard_rails.rail_content_hits(diff):
        scopes.append("security")
    if any(path.startswith(MIGRATION_ROOTS) for path in paths):
        scopes.append("migration")
    if needs_reach(paths, subjects):
        scopes.append("reach")
    return tuple(scopes)


def reverted_commit(sha, cwd, extra_paths=()):
    """The commit among origin/main's last REVERT_WINDOW first-parent commits that `sha` exactly reverts, or None.

    `extra_paths` is the file list GitHub reports; a path it names that the local diff lacks means the local
    `origin/main` is stale, so the PR is not treated as an exact revert.
    """
    if not supports_verbatim(git_version(cwd)):
        return None
    base = merge_base(sha, cwd)
    if base is None:
        return None
    paths = changed_names(base, sha, cwd)
    if paths is None or any(path.startswith(REVERT_EXCLUDED_ROOT) for path in paths):
        return None
    if any(path not in paths for path in extra_paths):
        return None
    target = verbatim_patch_id(pr_diff(base, sha, cwd), cwd)
    if target is None:
        return None
    listed = run_git(["rev-list", "--first-parent", "-n", str(REVERT_WINDOW), BASE_REF], cwd)
    for commit in text(listed or b"").splitlines():
        if verbatim_patch_id(pr_diff(commit, commit + "^", cwd), cwd) == target:
            return None if relands_a_commit(target, paths, cwd) else commit
    return None


def forward_patch_ids(paths, cwd):
    """Verbatim patch-ids of every first-parent commit on origin/main touching `paths`, or None on any git failure."""
    budget = seconds_left(RELAND_TIMEOUT_SECONDS)
    if budget <= 0:
        return None
    deadline = time.monotonic() + budget
    log_args = git_command(["--literal-pathspecs", *RELAND_LOG_ARGS, BASE_REF, "--", *paths])
    try:
        log = subprocess.Popen(log_args, cwd=cwd, env=git_env(), stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)
    except OSError:
        return None
    try:
        ids = subprocess.Popen(
            git_command(["patch-id", "--verbatim"]), cwd=cwd, env=git_env(), stdin=log.stdout,
            stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
        )
    except OSError:
        log.kill()
        log.wait()
        return None
    log.stdout.close()
    try:
        output, _ = ids.communicate(timeout=max(0.0, deadline - time.monotonic()))
        log.wait(timeout=max(0.0, deadline - time.monotonic()))
    except subprocess.TimeoutExpired:
        for process in (log, ids):
            process.kill()
            process.wait()
        ids.stdout.close()
        return None
    if log.returncode != 0 or ids.returncode != 0:
        return None
    return {line.split()[0] for line in text(output).splitlines() if line.split()}


def relands_a_commit(target, paths, cwd):
    """True when `target` is the forward patch of any first-parent commit on origin/main (fails closed to True)."""
    if not paths:
        return True
    forward = forward_patch_ids(paths, cwd)
    return forward is None or target in forward


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
        with open(path, "rb") as ledger:
            raw_lines = ledger.read().split(b"\n")
    except FileNotFoundError:
        return []
    entries = []
    for number, raw in enumerate(raw_lines, start=1):
        try:
            line = raw.decode("utf-8")
        except UnicodeDecodeError:
            raise LedgerError(path, number) from None
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


def unparsable_reason(error):
    return (
        f"{error.path} line {error.line_number} does not parse, so the ledger cannot be read and a block "
        "on that line could be missed; repair that line in place so it has the six tab-separated fields "
        "the record command writes (time, PR, full SHA, pass or block, one of "
        "engineering/security/migration/reach, patch-id or -), keeping its PR, SHA and verdict; never "
        "delete a line and never turn a block into a pass"
    )


def head_violation(pr, sha, cwd, extra_subjects=(), extra_paths=()):
    """None when the ledger backs a pass for PR `pr` at `sha` (the marker hook and the merge gate share this).

    `extra_subjects` are subjects the squash commit may take that are not commits (the PR title, at merge time);
    `extra_paths` is GitHub's file list for the PR, unioned with the local diff so a stale `origin/main` cannot
    narrow it. Every git call runs from the checkout's top level, whatever directory the session is in, and
    shares one CHECK_BUDGET_SECONDS deadline; a call that runs out fails toward more review.
    """
    with check_budget(CHECK_BUDGET_SECONDS):
        cwd = toplevel(cwd)
        if cwd is None:
            return "could not find this checkout's top level, so the review ledger cannot be checked"
        path = ledger_path(cwd)
        if path is None:
            return "could not find this checkout's git dir to read the review ledger"
        try:
            entries = read_entries(path)
        except LedgerError as error:
            return unparsable_reason(error)
        patch = patch_id(sha, cwd)
        reason = marker_violation(entries, pr, sha, patch, required_scopes(sha, cwd, extra_subjects, extra_paths))
        if reason is None:
            return None
        if reverted_commit(sha, cwd, extra_paths) is not None:
            return marker_violation(entries, pr, sha, patch, ())
        return reason


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
    cwd = toplevel(cwd)
    path = ledger_path(cwd) if cwd else None
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
