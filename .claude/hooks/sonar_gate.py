#!/usr/bin/env python3
"""
SonarCloud gate for a pull request: the analysis must exist for the PR's head
SHA, the quality gate must be OK, and there must be zero OPEN/CONFIRMED issues.

SonarCloud posts no GitHub check on this repo, so the gate is read from the API.
Fails closed: an unreachable Sonar or a missing analysis is a block, not a pass.

Used two ways:
  * `check-merge-status.py` imports `evaluate()` for a single check at merge time
    (PreToolUse hooks time out at 60s, so no polling there).
  * `/ship` runs `python3 .claude/hooks/sonar_gate.py --pr N --sha SHA --wait 300`
    before merging, which polls until the head-SHA analysis lands.
"""
import argparse
import json
import subprocess
import sys
import time

PROJECT_KEY = "Laer-Smart_2anki.net"
API = "https://sonarcloud.io/api"
OPEN_STATUSES = ("OPEN", "CONFIRMED")
POLL_SECONDS = 15
MIN_SHA_PREFIX = 7

CLEAN = "clean"
PENDING = "pending"
FAILED = "failed"


def fetch_json(url):
    result = subprocess.run(
        ["curl", "-fsS", "--max-time", "15", url],
        capture_output=True, text=True, timeout=20, check=True,
    )
    return json.loads(result.stdout)


def pr_analysis(pr_number, fetch):
    data = fetch(f"{API}/project_pull_requests/list?project={PROJECT_KEY}")
    for entry in data.get("pullRequests", []):
        if str(entry.get("key")) == str(pr_number):
            return {
                "sha": (entry.get("commit") or {}).get("sha") or "",
                "quality_gate": (entry.get("status") or {}).get("qualityGateStatus") or "",
            }
    return None


def analysis_matches_head(analysis_sha, head_sha):
    if len(head_sha) < MIN_SHA_PREFIX:
        return False
    return analysis_sha.startswith(head_sha)


def open_issues(pr_number, fetch):
    url = (
        f"{API}/issues/search?componentKeys={PROJECT_KEY}"
        f"&pullRequest={pr_number}&statuses=OPEN,CONFIRMED&sinceLeakPeriod=true&ps=100"
    )
    data = fetch(url)
    return [
        issue for issue in data.get("issues", [])
        if (issue.get("status") or "").upper() in OPEN_STATUSES
    ]


def describe_issue(issue):
    component = (issue.get("component") or "").split(":", 1)[-1]
    return f"{issue.get('rule')} {component}:{issue.get('line')} — {issue.get('message')}"


def classify_with_reason(pr_number, head_sha, fetch):
    try:
        analysis = pr_analysis(pr_number, fetch)
        if analysis is None:
            return PENDING, f"no SonarCloud analysis yet for PR #{pr_number}"
        if not analysis_matches_head(analysis["sha"], head_sha):
            return PENDING, (
                f"SonarCloud analysis is for {analysis['sha'][:12]}, head is {head_sha[:12]} "
                "— wait for the head-SHA analysis"
            )
        if analysis["quality_gate"] != "OK":
            return FAILED, f"SonarCloud quality gate is {analysis['quality_gate'] or 'unknown'}"
        issues = open_issues(pr_number, fetch)
    except (subprocess.SubprocessError, OSError, ValueError) as exc:
        return FAILED, f"SonarCloud unreachable ({exc}); failing closed"
    if issues:
        listing = "\n".join(f"    - {describe_issue(i)}" for i in issues)
        return FAILED, f"{len(issues)} open SonarCloud finding(s) on PR #{pr_number}:\n{listing}"
    return CLEAN, f"SonarCloud clean on {head_sha[:7]} (gate OK, 0 open findings)"


def classify(pr_number, head_sha, fetch=fetch_json):
    return classify_with_reason(pr_number, head_sha, fetch)[0]


def evaluate(pr_number, head_sha, fetch=fetch_json):
    state, reason = classify_with_reason(pr_number, head_sha, fetch)
    return state == CLEAN, reason


def wait_for_clean(pr_number, head_sha, wait_seconds, fetch=fetch_json, sleep=time.sleep):
    waited = 0
    while True:
        state, reason = classify_with_reason(pr_number, head_sha, fetch)
        if state != PENDING:
            return state == CLEAN, reason
        if waited >= wait_seconds:
            return False, f"{reason} (gave up after {wait_seconds}s)"
        step = min(POLL_SECONDS, wait_seconds - waited)
        sleep(step)
        waited += step


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--pr", required=True)
    parser.add_argument("--sha", required=True)
    parser.add_argument("--wait", type=int, default=0, help="seconds to poll for the head-SHA analysis")
    args = parser.parse_args()
    ok, reason = wait_for_clean(args.pr, args.sha, args.wait)
    print(reason)
    sys.exit(0 if ok else 1)


if __name__ == "__main__":
    main()
