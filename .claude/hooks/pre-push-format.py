#!/usr/bin/env python3
"""
PreToolUse hook: run oxfmt --check on the files this branch changed before
`git push`, plus a warn-only changelog-presence reminder.

Why: CI runs `pnpm format:check` (oxfmt --check over src + web/src) and rejects
the push on any format diff — costing a full push + CI cycle each time. A large
share of recent commits are pure "fix oxfmt" appeasement. This catches the same
diff locally in milliseconds.

Scope: changed files vs origin/main only — never the full tree. A full-tree
check would block every push whenever main itself carries a pre-existing format
violation (a merged PR can leave main red), which has nothing to do with the
branch being pushed.

Two gates:
1. Format (BLOCKS): oxfmt --check on changed .ts/.tsx/.js/.jsx under src/ and
   web/src/. On failure, prints the offending files and the exact fix command.
2. Changelog (WARNS only, never blocks): if the branch adds a feat:/fix: commit
   touching src/ or web/src/ (excluding tests) and no new changelog JSON file,
   prints a one-line reminder. The CLAUDE.md no-entry out-clause is legitimate,
   so this can never block.

Skips pushes to main/master (safety.py owns those). oxfmt applies its own
ignorePatterns from .oxfmtrc.json (templates, fixtures, generated, etc.), so we
don't re-implement that filter here — but when EVERY passed file is ignored,
oxfmt exits 2 with "Expected at least one target file"; that is treated as
clean, not as a format failure (kanel-regenerated data_layer/public files).

Bypass: CLAUDE_SKIP_FORMAT_CHECK=1 git push ...   (env var, or inline in the
        command string — both honored, mirroring the typecheck hook).
"""
import json
import os
import re
import subprocess
import sys

OXFMT_TIMEOUT_SECONDS = 30

FORMATTABLE_EXTS = (".ts", ".tsx", ".js", ".jsx")
FORMATTABLE_ROOTS = ("src/", "web/src/")
CHANGELOG_DIR = "web/src/pages/WhatsNewPage/changelog/"

GIT_PUSH = re.compile(r"\bgit\s+push\b")
PROTECTED_BRANCH = re.compile(r"\b(main|master)\b")
SKIP_IN_COMMAND = re.compile(r"\bCLAUDE_SKIP_FORMAT_CHECK=1\b")
NOT_INSTALLED = re.compile(
    r"command not found|ENOENT|not found|No such file|not be found",
    re.IGNORECASE,
)
# oxfmt exits 2 (not 0) when every file passed explicitly is excluded by the
# config's ignorePatterns — e.g. a push whose only formattable change is a
# kanel-regenerated src/data_layer/public/*.ts. CI never sees those files, so
# this is a clean result, not a format failure.
ALL_FILES_IGNORED = re.compile(
    r"All matched files may have been excluded by ignore rules",
    re.IGNORECASE,
)


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


def is_git_push(cmd):
    return bool(GIT_PUSH.search(cmd))


def push_targets_protected(cmd):
    after = GIT_PUSH.split(cmd, 1)[1]
    after = re.split(r"[;&|]", after, 1)[0]
    return bool(PROTECTED_BRANCH.search(after))


def git_lines(args, project_dir):
    try:
        result = subprocess.run(
            ["git"] + args,
            cwd=project_dir, capture_output=True, text=True, timeout=10,
        )
    except Exception:
        return None
    if result.returncode != 0:
        return None
    return result.stdout.splitlines()


def changed_paths(project_dir):
    """All paths that differ from origin/main or are uncommitted on the branch.
    None means git couldn't tell us — caller errs toward running the check."""
    committed = git_lines(
        ["diff", "--name-only", "origin/main...HEAD"], project_dir
    )
    working = git_lines(["diff", "--name-only", "HEAD"], project_dir)
    if committed is None and working is None:
        return None
    return list(dict.fromkeys((committed or []) + (working or [])))


def formattable(paths):
    return [
        p for p in paths
        if p.endswith(FORMATTABLE_EXTS) and p.startswith(FORMATTABLE_ROOTS)
    ]


def run_oxfmt_check(files, project_dir):
    """True = clean, str = offending output, None = couldn't run (fail open)."""
    try:
        result = subprocess.run(
            ["pnpm", "exec", "oxfmt", "-c", ".oxfmtrc.json",
             "--threads", "1", "--check"] + files,
            cwd=project_dir, capture_output=True, text=True,
            timeout=OXFMT_TIMEOUT_SECONDS,
        )
    except subprocess.TimeoutExpired:
        sys.stderr.write(
            f"[pre-push-format] oxfmt exceeded {OXFMT_TIMEOUT_SECONDS}s; "
            "allowing push.\n"
        )
        return None
    except FileNotFoundError:
        sys.stderr.write("[pre-push-format] pnpm not on PATH; allowing push.\n")
        return None
    if result.returncode == 0:
        return True
    output = result.stdout or result.stderr or "(no output)"
    if result.returncode == 2 and ALL_FILES_IGNORED.search(output):
        return True
    if NOT_INSTALLED.search(output):
        sys.stderr.write(
            "[pre-push-format] oxfmt isn't installed in this checkout "
            "(common in agent worktrees). Run `pnpm install`, then push again "
            "to get the format gate. Allowing this push.\n"
        )
        return None
    return output


def offending_files(output, candidates):
    named = [f for f in candidates if f in output]
    return named or candidates


def deny_for_format(output, files):
    offenders = offending_files(output, files)
    listing = "\n".join(f"  {f}" for f in offenders[:20])
    fix_cmd = "pnpm exec oxfmt -c .oxfmtrc.json --threads 1 --write " + " ".join(
        offenders
    )
    deny(
        "Refusing `git push` — oxfmt found format issues in changed files "
        "(CI's `pnpm format:check` would reject this push):\n\n"
        f"{listing}\n\n"
        "Fix them with:\n"
        f"  {fix_cmd}\n\n"
        "Then re-stage and push. Bypass with CLAUDE_SKIP_FORMAT_CHECK=1 if "
        "you're pushing a WIP branch."
    )


def commit_subjects(project_dir):
    lines = git_lines(
        ["log", "--format=%s", "origin/main..HEAD"], project_dir
    )
    return lines or []


def branch_adds_changelog(paths):
    return any(
        p.startswith(CHANGELOG_DIR) and p.endswith(".json") for p in paths
    )


def is_test_path(path):
    return ".test." in path or ".spec." in path or "/__tests__/" in path


def touches_user_facing_source(paths):
    return any(
        p.startswith(FORMATTABLE_ROOTS)
        and not is_test_path(p)
        and not p.startswith(CHANGELOG_DIR)
        for p in paths
    )


FEAT_FIX_SUBJECT = re.compile(r"^(feat|fix)(\([^)]*\))?!?:", re.IGNORECASE)


def warn_changelog_if_missing(paths, project_dir):
    if branch_adds_changelog(paths):
        return
    if not touches_user_facing_source(paths):
        return
    subjects = commit_subjects(project_dir)
    if not any(FEAT_FIX_SUBJECT.match(s) for s in subjects):
        return
    sys.stderr.write(
        "[pre-push-format] reminder: this branch has a feat:/fix: commit "
        "touching src/ or web/src/ but adds no changelog entry under "
        f"{CHANGELOG_DIR}. CLAUDE.md's changelog table expects one for "
        "user-visible feat:/fix: changes. If this change isn't user-visible, "
        "state the no-entry out-clause in the PR body "
        "(\"no changelog entry — internal-only ...\"). Not blocking.\n"
    )


def main():
    if os.environ.get("CLAUDE_SKIP_FORMAT_CHECK"):
        allow()

    try:
        data = json.loads(sys.stdin.read())
    except json.JSONDecodeError:
        allow()

    if data.get("tool_name") != "Bash":
        allow()

    cmd = data.get("tool_input", {}).get("command", "")
    if not is_git_push(cmd):
        allow()

    if SKIP_IN_COMMAND.search(cmd):
        allow()

    if push_targets_protected(cmd):
        allow()

    project_dir = os.environ.get("CLAUDE_PROJECT_DIR") or os.getcwd()

    paths = changed_paths(project_dir)
    if paths is None:
        allow()

    warn_changelog_if_missing(paths, project_dir)

    files = formattable(paths)
    if not files:
        allow()

    sys.stderr.write(
        f"[pre-push-format] running oxfmt --check on {len(files)} changed "
        "file(s)...\n"
    )
    result = run_oxfmt_check(files, project_dir)
    if isinstance(result, str):
        deny_for_format(result, files)

    allow()


if __name__ == "__main__":
    main()
