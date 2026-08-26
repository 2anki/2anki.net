#!/usr/bin/env python3
"""
PreToolUse -> Bash: block `gh pr merge` when a user-visible PR (a feat: or fix:
commit touching non-test source) ships without a changelog entry AND without an
explicit out-clause in the PR body.

Mirrors check-browser-attestation.py: fetches the PR via gh, fails open on any
tooling error, exempts dependabot. The out-clause keeps it from over-firing on
internal feat:/fix: work that genuinely needs no entry.

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


def extract_pr_ref(cmd):
    return merge_command.extract_pr_ref(cmd)


def fetch_pr_data(pr_ref):
    args = ["gh", "pr", "view"]
    if pr_ref is not None:
        args.append(pr_ref)
    args.extend(["--json", "author,body,files,commits"])
    try:
        result = subprocess.run(args, capture_output=True, text=True, timeout=15)
    except (subprocess.TimeoutExpired, FileNotFoundError) as exc:
        sys.stderr.write(
            f"[check-changelog-on-merge] could not run gh ({exc}); allowing merge.\n"
        )
        return None
    if result.returncode != 0:
        sys.stderr.write(
            "[check-changelog-on-merge] gh pr view failed; allowing merge. "
            f"stderr: {result.stderr.strip()[:300]}\n"
        )
        return None
    try:
        return json.loads(result.stdout)
    except json.JSONDecodeError:
        sys.stderr.write(
            "[check-changelog-on-merge] could not parse gh JSON; allowing merge.\n"
        )
        return None


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

    pr_data = fetch_pr_data(extract_pr_ref(cmd))
    if pr_data is None:
        allow()

    if pr_data.get("author", {}).get("login", "") == "dependabot[bot]":
        allow()

    if not has_user_visible_commit(pr_data.get("commits") or []):
        allow()

    paths = [f.get("path", "") for f in (pr_data.get("files") or [])]

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
    )


if __name__ == "__main__":
    main()
