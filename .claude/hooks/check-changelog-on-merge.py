#!/usr/bin/env python3
"""
PreToolUse -> Bash: block `gh pr merge` when a user-visible PR (a feat: or fix:
commit touching non-test source) ships without a changelog entry AND without an
explicit out-clause in the PR body.

Mirrors check-browser-attestation.py: accepts only the exact merge command
/ship runs (`merge_command.allowed_merge`), fetches the PR via `gh pr view -R`,
refuses the merge when that errors, exempts dependabot. Changed paths come from
`merge_command.changed_files`, the paginated REST list every merge hook
shares. When that call fails the hook checks what it did before: `gh pr
view`'s first 100 files, plus `gh pr diff --name-only` when the view hits that
cap (GitHub refuses diffs over 300 files, and a name containing ` b/` can
misparse), and only the first 100 when the diff fails too. The out-clause
keeps it from over-firing on internal feat:/fix: work that genuinely needs no
entry.

CLAUDE.md > Changelog is the rule this enforces.
"""
import json
import os
import re
import subprocess
import sys

HOOKS_DIR = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HOOKS_DIR)

import merge_command  # noqa: E402


CHANGELOG_DIR_PREFIX = "web/src/pages/WhatsNewPage/changelog/"
OUT_CLAUSE = re.compile(r"no changelog entry", re.IGNORECASE)

GH_PR_VIEW_FILES_CAP = 100

TAG = "[check-changelog-on-merge]"

USER_VISIBLE_PREFIX = re.compile(r"^(feat|fix)(\([^)]*\))?!?:", re.IGNORECASE)


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


def is_gh_pr_merge(cmd):
    return merge_command.is_gh_pr_merge(cmd)


def fetch_pr_data(number, repo):
    args = ["gh", "pr", "view", number, "-R", repo, "--json", "number,url,author,body,files,commits"]
    try:
        result = subprocess.run(args, capture_output=True, text=True, timeout=15)
    except (subprocess.TimeoutExpired, OSError) as exc:
        sys.stderr.write(f"{TAG} could not run gh ({exc}); refusing merge.\n")
        return None
    if result.returncode != 0:
        sys.stderr.write(
            f"{TAG} gh pr view failed; refusing merge. "
            f"stderr: {result.stderr.strip()[:300]}\n"
        )
        return None
    try:
        parsed = json.loads(result.stdout)
    except json.JSONDecodeError:
        sys.stderr.write(f"{TAG} could not parse gh JSON; refusing merge.\n")
        return None
    return parsed if isinstance(parsed, dict) else None


def fetch_changed_paths(number, repo):
    args = ["gh", "pr", "diff", number, "-R", repo, "--name-only"]
    try:
        result = subprocess.run(
            args, capture_output=True, text=True, errors="replace", timeout=15
        )
    except (subprocess.TimeoutExpired, OSError) as exc:
        sys.stderr.write(
            f"[check-changelog-on-merge] could not run gh pr diff ({exc}); "
            "checking only gh pr view's first 100 files.\n"
        )
        return None
    if result.returncode != 0:
        sys.stderr.write(
            "[check-changelog-on-merge] gh pr diff failed; "
            "checking only gh pr view's first 100 files. "
            f"stderr: {result.stderr.strip()[:300]}\n"
        )
        return None
    return [line.strip() for line in result.stdout.splitlines() if line.strip()]


def list_paths_past_view_cap(view_paths, number, repo):
    if len(view_paths) < GH_PR_VIEW_FILES_CAP:
        return []
    return fetch_changed_paths(number, repo)


def diff_failure_note(diff_paths):
    if diff_paths is None:
        return (
            "\n\ngh pr diff failed, so only the first 100 changed files were checked."
        )
    return ""


def has_user_visible_commit(commits):
    for commit in commits:
        headline = commit.get("messageHeadline") or ""
        if USER_VISIBLE_PREFIX.match(headline.strip()):
            return True
    return False


def is_non_test_source(path):
    if not (path.startswith("src/") or path.startswith("web/src/")):
        return False
    if not (path.endswith(".ts") or path.endswith(".tsx")):
        return False
    if path.endswith(".d.ts") or ".test." in path:
        return False
    if "/migrations/" in path or "/templates/" in path or "/fixtures/" in path:
        return False
    if path.startswith("src/data_layer/public/"):
        return False
    return True


def main():
    try:
        data = json.loads(sys.stdin.read())
    except json.JSONDecodeError:
        allow()

    if data.get("tool_name") != "Bash":
        allow()

    cmd = data.get("tool_input", {}).get("command", "")
    if not is_gh_pr_merge(cmd):
        allow()

    form_violation = merge_command.merge_form_violation(cmd)
    if form_violation:
        deny(form_violation)

    number, repo = merge_command.allowed_merge(cmd)
    pr_data = fetch_pr_data(number, repo)
    if pr_data is None:
        deny(merge_command.view_failed_violation(number))

    view_violation = merge_command.view_repo_violation(pr_data, number)
    if view_violation:
        deny(view_violation)

    if (pr_data.get("author") or {}).get("login", "") == "dependabot[bot]":
        allow()

    if not has_user_visible_commit(pr_data.get("commits") or []):
        allow()

    files, complete = merge_command.changed_files(pr_data, number, TAG)
    paths = [f.get("path", "") for f in files]
    diff_paths = [] if complete else list_paths_past_view_cap(paths, number, repo)
    paths = paths + (diff_paths or [])

    if not any(is_non_test_source(p) for p in paths):
        allow()

    if any(p.startswith(CHANGELOG_DIR_PREFIX) and p.endswith(".json") for p in paths):
        allow()

    if OUT_CLAUSE.search(pr_data.get("body") or ""):
        allow()

    deny(
        "Refusing `gh pr merge` — this PR has a feat:/fix: commit touching source "
        "but ships no changelog entry.\n\n"
        "CLAUDE.md > Changelog: user-visible changes ship with an entry in the same PR.\n\n"
        "  Add one:   web/src/pages/WhatsNewPage/changelog/YYYY-MM-DD-slug.json\n"
        "             (see CLAUDE.md > Changelog for the file shape and voice)\n\n"
        "  Or, if no user would notice this change, state so in the PR body with a line\n"
        "  containing \"no changelog entry\" (e.g. \"no changelog entry — internal refactor\").\n\n"
        "Dependabot PRs are exempt automatically."
        + diff_failure_note(diff_paths)
    )


if __name__ == "__main__":
    main()
