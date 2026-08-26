#!/usr/bin/env python3
import json
import os
import subprocess
import sys

HOOKS_DIR = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HOOKS_DIR)

import merge_command  # noqa: E402


CHECKBOX_GOLDEN_PATH = "- [x] Golden path on localhost:3000"
CHECKBOX_CONSOLE_ERRORS = "- [x] No console errors at 375px"
OUT_CLAUSE_PREFIX = "Browser check: not applicable —"
CHANGELOG_DIR_PREFIX = "web/src/pages/WhatsNewPage/changelog/"



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
    args.extend(["--json", "author,body,files"])
    try:
        result = subprocess.run(args, capture_output=True, text=True, timeout=15)
    except (subprocess.TimeoutExpired, FileNotFoundError) as exc:
        sys.stderr.write(
            f"[check-browser-attestation] could not run gh ({exc}); allowing merge.\n"
        )
        return None
    if result.returncode != 0:
        sys.stderr.write(
            "[check-browser-attestation] gh pr view failed; allowing merge. "
            f"stderr: {result.stderr.strip()[:300]}\n"
        )
        return None
    try:
        return json.loads(result.stdout)
    except json.JSONDecodeError:
        sys.stderr.write(
            "[check-browser-attestation] could not parse gh JSON; allowing merge.\n"
        )
        return None


def web_src_files(files):
    return [f["path"] for f in files if f.get("path", "").startswith("web/src/")]


def is_changelog_only(paths):
    if not paths:
        return False
    return all(p.startswith(CHANGELOG_DIR_PREFIX) for p in paths)


def attestation_satisfied(body):
    if body and OUT_CLAUSE_PREFIX in body:
        return True
    return (
        body is not None
        and CHECKBOX_GOLDEN_PATH in body
        and CHECKBOX_CONSOLE_ERRORS in body
    )


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

    pr_ref = extract_pr_ref(cmd)
    pr_data = fetch_pr_data(pr_ref)
    if pr_data is None:
        allow()

    author = pr_data.get("author", {}).get("login", "")
    if author == "dependabot[bot]":
        allow()

    files = pr_data.get("files") or []
    touching = web_src_files(files)

    if not touching:
        allow()

    if is_changelog_only(touching):
        allow()

    body = pr_data.get("body") or ""
    if attestation_satisfied(body):
        allow()

    deny(
        "Refusing `gh pr merge` — this PR touches `web/src/` but the browser attestation is missing.\n\n"
        "Add one of the following to the PR body before merging:\n\n"
        "  Option A — tick both checkboxes:\n"
        "    - [x] Golden path on localhost:3000\n"
        "    - [x] No console errors at 375px\n\n"
        "  Option B — out-clause (for internal-only / non-UI changes):\n"
        "    Browser check: not applicable — <reason>\n\n"
        "See .claude/docs/browser-attestation.md for details.\n"
        "Dependabot PRs and changelog-only diffs are exempt automatically."
    )


if __name__ == "__main__":
    main()
