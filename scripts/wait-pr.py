"""Wait for a PR's checks to finish, then say whether it is green.

Usage: python3 -I scripts/wait-pr.py <pr> [old head sha] [--timeout SECONDS] [--interval SECONDS]

Polls `gh pr view` until the head no longer starts with the old sha (when one
is given, full or short),
the branch is not BEHIND main, and every check has completed, then prints the
state, the head and every check that is not green. A closed or landed PR ends
the wait at once. It only reads: it never pushes, edits or lands anything.

Green follows the merge gate in .claude/hooks/check-merge-status.py: no check
failed, errored, timed out or was cancelled, and every `test*` check concluded
SUCCESS (a skipped test job is not green). A DIRTY merge state is not green.

Exit codes: 0 green, 1 not green, 3 timed out; argparse uses 2 for usage errors.
Tests: python3 scripts/wait-pr.test.py
"""

import argparse
import json
import re
import subprocess
import sys
import time

GREEN = 0
NOT_GREEN = 1
TIMED_OUT = 3
GH_TIMEOUT_SECONDS = 60

RUNNING_STATES = {"PENDING", "EXPECTED"}
BAD_CONCLUSIONS = {"FAILURE", "ERROR", "TIMED_OUT", "CANCELLED", "ACTION_REQUIRED", "STARTUP_FAILURE", "STALE"}
UNSETTLED_MERGE_STATES = {"BEHIND", "UNKNOWN"}


def check_name(check):
    return check.get("name") or check.get("context") or "<unnamed>"


def check_result(check):
    return (check.get("conclusion") or check.get("state") or "").upper()


def is_running(check):
    status = (check.get("status") or "").upper()
    if status:
        return status != "COMPLETED"
    return (check.get("state") or "").upper() in RUNNING_STATES


def is_green(check):
    result = check_result(check)
    if check_name(check).lower().startswith("test"):
        return result == "SUCCESS"
    return result not in BAD_CONCLUSIONS


def decide(view, old_sha=None):
    """Return ("wait", None) or (verdict, report) for one `gh pr view` payload."""
    checks = view.get("statusCheckRollup") or []
    state = view.get("state")
    merge_state = view.get("mergeStateStatus")
    head = view.get("headRefOid")
    settled = (
        (old_sha is None or not (head or "").startswith(old_sha))
        and bool(checks)
        and not any(is_running(c) for c in checks)
        and merge_state not in UNSETTLED_MERGE_STATES
    )
    if state == "OPEN" and not settled:
        return "wait", None
    not_green = [f"{check_name(c)}: {check_result(c) or 'RUNNING'}" for c in checks if is_running(c) or not is_green(c)]
    if merge_state == "DIRTY":
        not_green.append("merge state: DIRTY")
    if not checks:
        not_green.append("no checks reported")
    report = {
        "state": state,
        "merge_state": merge_state,
        "head": head,
        "not_green": not_green,
        "test_checks": [f"{check_name(c)}: {check_result(c)}" for c in checks if check_name(c).lower().startswith("test")],
    }
    return ("green" if not not_green else "not green"), report


def fetch_view(pr, run=subprocess.run):
    try:
        completed = run(
            ["gh", "pr", "view", pr, "--repo", "2anki/server", "--json", "mergeStateStatus,headRefOid,statusCheckRollup,state"],
            capture_output=True,
            text=True,
            timeout=GH_TIMEOUT_SECONDS,
        )
    except subprocess.TimeoutExpired:
        return None
    if completed.returncode != 0:
        return None
    try:
        view = json.loads(completed.stdout)
    except ValueError:
        return None
    return view if isinstance(view, dict) else None


def wait(fetch, old_sha, timeout, interval, sleep=time.sleep, now=time.monotonic, out=sys.stdout):
    deadline = now() + timeout
    last_view = None
    while True:
        view = fetch()
        if view is not None:
            last_view = view
            verdict, report = decide(view, old_sha)
            if verdict != "wait":
                print(f"{verdict}: {report['state']} {report['merge_state']} {report['head']}", file=out)
                print(f"not green: {report['not_green']}", file=out)
                print(f"test checks: {report['test_checks']}", file=out)
                return GREEN if verdict == "green" else NOT_GREEN
        if now() >= deadline:
            if last_view is None:
                print("timed out: gh never returned the PR", file=out)
            else:
                running = sum(1 for c in last_view.get("statusCheckRollup") or [] if is_running(c))
                print(f"timed out: {last_view.get('mergeStateStatus')} {last_view.get('headRefOid')}, {running} checks running", file=out)
            return TIMED_OUT
        sleep(interval)


def parse_args(argv):
    parser = argparse.ArgumentParser(description="Wait for a PR's checks, then report what is not green.")
    parser.add_argument("pr", help="PR number")
    parser.add_argument("old_sha", nargs="?", help="head sha to wait past, for example the head before a push")
    parser.add_argument("--timeout", type=int, default=40 * 60, help="seconds to wait before giving up (default 2400)")
    parser.add_argument("--interval", type=int, default=30, help="seconds between polls (default 30)")
    args = parser.parse_args(argv)
    if not re.fullmatch(r"[1-9][0-9]*", args.pr):
        parser.error("the PR must be a number")
    if args.old_sha is not None and not re.fullmatch(r"[0-9a-f]{7,40}", args.old_sha):
        parser.error("the old sha must be 7 to 40 lowercase hex characters")
    if args.timeout < 0 or args.interval < 1:
        parser.error("the timeout must be 0 or more and the interval 1 or more")
    return args


def main(argv=None):
    args = parse_args(sys.argv[1:] if argv is None else argv)
    return wait(lambda: fetch_view(args.pr), args.old_sha, args.timeout, args.interval)


if __name__ == "__main__":
    sys.exit(main())
