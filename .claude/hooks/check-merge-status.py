#!/usr/bin/env python3
"""
PreToolUse hook: gate `gh pr merge` on the full check rollup, not just FAILURE.

Blocks the merge when ANY of these hold:
  1. Any rollup entry concluded FAILURE (or a commit status reports FAILURE/ERROR).
  2. Any rollup entry has not COMPLETED yet (merge-while-running).
  3. Any check named `test*` concluded SKIPPED or CANCELLED — a skipped test job
     is not a green check. 2026-08-06: the markdown-it 15 bump merged on a
     rollup whose server `test` job was SKIPPED (its CI predated the workflow
     fix in #4000 that made dependabot PRs run the suite); the suite would have
     caught the boot crash that took prod down.
  4. The PR touches package.json or pnpm-lock.yaml but no `test*` check
     concluded SUCCESS — a dependency change with no test run is unverified.

Bypass: CLAUDE_SKIP_SAFETY=1 gh pr merge ...
"""
import json
import os
import re
import subprocess
import sys


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


GH_PR_MERGE = re.compile(r"\bgh\s+pr\s+merge\b")
PR_URL = re.compile(r"https?://github\.com/[^/]+/[^/]+/pull/(\d+)")


def is_gh_pr_merge(cmd):
    return bool(GH_PR_MERGE.search(cmd))


def extract_pr_ref(cmd):
    after = GH_PR_MERGE.split(cmd, 1)[1]
    after = re.split(r"[;&|]", after, 1)[0]
    url_match = PR_URL.search(after)
    if url_match:
        return url_match.group(1)
    tokens = [t for t in after.split() if not t.startswith("-")]
    for token in tokens:
        if token.isdigit():
            return token
    return None


def fetch_pr_data(pr_ref):
    args = ["gh", "pr", "view"]
    if pr_ref is not None:
        args.append(pr_ref)
    args.extend(["--json", "statusCheckRollup,files"])
    try:
        result = subprocess.run(
            args, capture_output=True, text=True, timeout=15,
        )
    except (subprocess.TimeoutExpired, FileNotFoundError) as exc:
        sys.stderr.write(
            f"[check-merge-status] could not run gh ({exc}); allowing merge.\n"
        )
        return None
    if result.returncode != 0:
        sys.stderr.write(
            "[check-merge-status] gh pr view failed; allowing merge. "
            f"stderr: {result.stderr.strip()[:300]}\n"
        )
        return None
    try:
        return json.loads(result.stdout)
    except json.JSONDecodeError:
        sys.stderr.write(
            "[check-merge-status] could not parse gh JSON; allowing merge.\n"
        )
        return None


def entry_name(entry):
    return entry.get("name") or entry.get("context") or "<unnamed>"


def is_test_check(entry):
    return entry_name(entry).lower().startswith("test")


def classify(rollup, files):
    """Return a list of human-readable violations for this rollup."""
    violations = []
    test_success_seen = False
    for entry in rollup:
        name = entry_name(entry)
        conclusion = (entry.get("conclusion") or "").upper()
        state = (entry.get("state") or "").upper()
        status = (entry.get("status") or "").upper()

        if conclusion == "FAILURE" or state in ("FAILURE", "ERROR"):
            violations.append(f"{name}: FAILURE")
            continue
        if status and status != "COMPLETED":
            violations.append(f"{name}: still {status} — wait for it to finish")
            continue
        if state == "PENDING":
            violations.append(f"{name}: still PENDING — wait for it to finish")
            continue
        if is_test_check(entry):
            if conclusion in ("SKIPPED", "CANCELLED"):
                violations.append(
                    f"{name}: {conclusion} — a skipped test job is not green; "
                    "re-run CI (gh run rerun / @dependabot rebase) so the suite "
                    "actually executes on this head SHA"
                )
                continue
            if conclusion == "SUCCESS":
                test_success_seen = True

    touches_deps = any(
        f.get("path") in ("package.json", "pnpm-lock.yaml")
        for f in files
    )
    if touches_deps and not test_success_seen:
        violations.append(
            "PR changes package.json/pnpm-lock.yaml but no `test` check "
            "concluded SUCCESS — a dependency change with no test run is "
            "unverified (this is how the markdown-it 15 boot crash shipped)"
        )
    return violations


def main():
    if os.environ.get("CLAUDE_SKIP_SAFETY"):
        allow()

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

    rollup = pr_data.get("statusCheckRollup") or []
    files = pr_data.get("files") or []

    violations = classify(rollup, files)
    if violations:
        bullet_list = "\n".join(f"  - {v}" for v in violations)
        deny(
            "Refusing `gh pr merge` — check rollup is not verifiably green:\n"
            f"{bullet_list}\n\n"
            "Every rollup entry must be COMPLETED and non-FAILURE, every test "
            "job must have actually RUN (SKIPPED/CANCELLED test jobs block), "
            "and dependency changes need a SUCCESS test run.\n"
            "Bypass with CLAUDE_SKIP_SAFETY=1 only after verifying by hand."
        )

    allow()


if __name__ == "__main__":
    main()
