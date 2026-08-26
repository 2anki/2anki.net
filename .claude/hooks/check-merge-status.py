#!/usr/bin/env python3
"""
PreToolUse hook: gate `gh pr merge` on the autonomous-shipping merge gate.

Denies the merge when ANY of these hold (see .claude/docs/autonomous-shipping.md):
  1. The PR touches a hard-rail path or its diff contains a rail content trigger
     (`hard_rails.py`) — those PRs wait for Alexander in the GitHub UI.
  2. Any rollup entry concluded FAILURE (or a commit status reports FAILURE/ERROR).
  3. Any rollup entry has not COMPLETED yet (merge-while-running).
  4. Any check named `test*` concluded SKIPPED or CANCELLED — a skipped test job
     is not a green check. 2026-08-06: the markdown-it 15 bump merged on a
     rollup whose server `test` job was SKIPPED (its CI predated the workflow
     fix in #4000 that made dependabot PRs run the suite); the suite would have
     caught the boot crash that took prod down.
  5. The PR touches package.json or pnpm-lock.yaml but no `test*` check
     concluded SUCCESS — a dependency change with no test run is unverified.
  6. No review-agent pass marker for the head SHA
     (`<!-- ship-review: pass sha=<headRefOid> -->`, full 40-char SHA, posted by
     /ship). Dependabot PRs are exempt — the /batch dependabot decision matrix is their review.
  7. SonarCloud is not clean for the head SHA (`sonar_gate.py`; fails closed).

`gh pr view` tooling errors fail open (a broken gh should not block a human);
the rail diff fetch and Sonar fail closed (an unchecked rail or an unscanned
merge is the exact gap the gate closes).

Bypass: `CLAUDE_SKIP_SAFETY=1 gh pr merge ...` — honored both as a process env var
and as a prefix in the command string (a PreToolUse hook runs before the shell,
so the prefix never reaches os.environ). For Alexander only, never /ship.
"""
import json
import os
import re
import subprocess
import sys

HOOKS_DIR = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HOOKS_DIR)

import hard_rails  # noqa: E402
import merge_command  # noqa: E402
import sonar_gate  # noqa: E402


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
REVIEW_MARKER = re.compile(r"<!--\s*ship-review:\s*pass\s+sha=([0-9a-f]{40})\s*-->")
DEPENDABOT = "dependabot[bot]"
SKIP_SAFETY_PREFIX = re.compile(r"\bCLAUDE_SKIP_SAFETY=1\b")


def is_gh_pr_merge(cmd):
    return merge_command.is_gh_pr_merge(cmd)


def extract_pr_ref(cmd):
    after = GH_PR_MERGE.split(merge_command.strip_literals(cmd), 1)[1]
    after = re.split(r"[;&|]", after, maxsplit=1)[0]
    url_match = PR_URL.search(after)
    if url_match:
        return url_match.group(1)
    tokens = [t for t in after.split() if not t.startswith("-")]
    for token in tokens:
        if token.isdigit():
            return token
    return None


def run_gh(args, label):
    try:
        result = subprocess.run(args, capture_output=True, text=True, timeout=15)
    except (subprocess.TimeoutExpired, FileNotFoundError) as exc:
        sys.stderr.write(f"[check-merge-status] could not run gh for {label} ({exc}); allowing.\n")
        return None
    if result.returncode != 0:
        sys.stderr.write(
            f"[check-merge-status] gh {label} failed; allowing. "
            f"stderr: {result.stderr.strip()[:300]}\n"
        )
        return None
    return result.stdout


def pr_args(pr_ref):
    return [pr_ref] if pr_ref is not None else []


def fetch_pr_data(pr_ref):
    stdout = run_gh(
        ["gh", "pr", "view", *pr_args(pr_ref), "--json",
         "number,headRefOid,author,files,statusCheckRollup,reviews,comments"],
        "pr view",
    )
    if stdout is None:
        return None
    try:
        return json.loads(stdout)
    except json.JSONDecodeError:
        sys.stderr.write("[check-merge-status] could not parse gh JSON; allowing merge.\n")
        return None


def fetch_pr_diff(pr_ref):
    return run_gh(["gh", "pr", "diff", *pr_args(pr_ref)], "pr diff")


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


def review_marker_violation(pr_data):
    head = pr_data.get("headRefOid") or ""
    bodies = [r.get("body") or "" for r in pr_data.get("reviews") or []]
    bodies += [c.get("body") or "" for c in pr_data.get("comments") or []]
    seen_shas = []
    for body in bodies:
        for match in REVIEW_MARKER.finditer(body):
            sha = match.group(1)
            if sha == head:
                return None
            seen_shas.append(sha)
    if seen_shas:
        stale = ", ".join(s[:7] for s in seen_shas)
        return (
            f"review-agent marker is for {stale} but head is {head[:7]} — the branch "
            "moved after review; run /ship again so the review agent re-reads the diff"
        )
    return (
        "no review-agent pass marker (`<!-- ship-review: pass sha=<head> -->`) on this PR "
        "— merge through /ship, which runs the review agent and posts the marker"
    )


def rail_reason(paths, content_hits):
    lines = []
    if paths:
        lines.append("  paths:")
        lines.extend(f"    - {p}" for p in paths)
    if content_hits:
        lines.append("  diff contains:")
        lines.extend(f"    - {h}" for h in content_hits)
    return (
        "Refusing `gh pr merge` — this PR touches a hard rail, which agents never merge:\n"
        + "\n".join(lines)
        + "\n\nFlip it ready, post the review-agent result, print the PR URL, and stop. "
        "Alexander merges hard-rail PRs from the GitHub UI. "
        "The rail list lives in .claude/hooks/hard_rails.py."
    )


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

    if SKIP_SAFETY_PREFIX.search(cmd):
        sys.stderr.write("[check-merge-status] CLAUDE_SKIP_SAFETY=1 in command; allowing merge.\n")
        allow()

    pr_ref = extract_pr_ref(cmd)
    pr_data = fetch_pr_data(pr_ref)
    if pr_data is None:
        allow()

    rollup = pr_data.get("statusCheckRollup") or []
    files = pr_data.get("files") or []
    paths = [f.get("path") or "" for f in files]
    author = (pr_data.get("author") or {}).get("login", "")

    rail_hits = hard_rails.rail_paths(paths)
    diff = fetch_pr_diff(pr_ref)
    if diff is None:
        deny(
            "Refusing `gh pr merge` — could not fetch the PR diff for the hard-rail "
            "content check. Retry, or verify by hand and merge from the GitHub UI."
        )
    content_hits = hard_rails.rail_content_hits(diff)
    if rail_hits or content_hits:
        deny(rail_reason(rail_hits, content_hits))

    violations = classify(rollup, files)

    if author != DEPENDABOT:
        marker_violation = review_marker_violation(pr_data)
        if marker_violation:
            violations.append(marker_violation)

    sonar_ok, sonar_reason = sonar_gate.evaluate(
        pr_data.get("number"), pr_data.get("headRefOid") or ""
    )
    if not sonar_ok:
        violations.append(sonar_reason)

    if violations:
        bullet_list = "\n".join(f"  - {v}" for v in violations)
        deny(
            "Refusing `gh pr merge` — the merge gate is not satisfied:\n"
            f"{bullet_list}\n\n"
            "Every rollup entry must be COMPLETED and non-FAILURE, every test "
            "job must have actually RUN, dependency changes need a SUCCESS test run, "
            "the review agent must have passed the head SHA, and SonarCloud must be clean.\n"
            "Bypass with CLAUDE_SKIP_SAFETY=1 only after verifying by hand (never from /ship)."
        )

    allow()


if __name__ == "__main__":
    main()
