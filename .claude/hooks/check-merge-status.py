#!/usr/bin/env python3
"""
PreToolUse hook: gate `gh pr merge` on the autonomous-shipping merge gate.

Denies the merge when ANY of these hold (see .claude/docs/autonomous-shipping.md):
  1. Any rollup entry concluded FAILURE (or a commit status reports FAILURE/ERROR).
  2. Any rollup entry has not COMPLETED yet (merge-while-running).
  3. Any check named `test*` concluded SKIPPED or CANCELLED — a skipped test job
     is not a green check. 2026-08-06: the markdown-it 15 bump merged on a
     rollup whose server `test` job was SKIPPED (its CI predated the workflow
     fix in #4000 that made dependabot PRs run the suite); the suite would have
     caught the boot crash that took prod down.
  4. The PR touches package.json or pnpm-lock.yaml but no `test*` check
     concluded SUCCESS — a dependency change with no test run is unverified.
  5. No review-agent pass marker for the head SHA
     (`<!-- ship-review: pass sha=<headRefOid> -->`, full 40-char SHA, posted by
     /ship). Dependabot PRs are exempt — the /batch dependabot decision matrix is their review.
  6. The PR came from a spec PR but the body has no `## Deviations from spec`
     heading — an implement PR must list where the code departs from the spec
     (issue #4427 item 4). "Came from a spec" needs BOTH the `<type>/spec-<slug>`
     branch name (`/spec-draft-pr`'s) AND a spec-lifecycle commit headline
     (`add spec for …` or `remove implemented spec …`). The commit evidence is
     what keeps a non-spec branch whose slug merely starts with `spec`
     (`chore/spec-lifecycle-gates`) from tripping the gate.
  7. A `feat:`/`fix:`/`perf:`/`refactor:` PR (title or any commit headline)
     changes reach source but the body has no non-empty
     `## Who else this reaches` section. Reach
     source is any file under `src/` or `web/src/` except tests (`.test.`,
     `.spec.`, `__tests__/`, `__snapshots__/`, `src/test/`, `web/src/test/`,
     `/fixtures/`, `__fixtures__/`, `_mock/`, `setupTests.`), changelog JSON
     and Markdown docs. Empty means nothing but whitespace, HTML comments,
     bullet marks, a table header with no rows, or lines and table rows made
     only of TBD/TODO/N/A/None/-/... placeholders or empty cells. Reverts (`revert:`, GitHub's `Revert "…"`) are exempt.
     #4589 claimed its control arm was "byte-for-byte unchanged" and silently
     dropped the held-back-cards notice for signed-in free users for 19 days
     (#4789); #4730 broke prerendered landing pages (#4901). Both reviews read
     the diff for the intended change and nobody listed who else reached it.

`gh pr view` tooling errors fail open (a broken gh should not block a human).

Hard-rail PRs (`hard_rails.py`) are no longer refused here (removed 2026-10-05):
/ship classifies them and runs extra verification instead of parking them.

The SonarCloud condition was removed on 2026-10-01. It was a serial wait after
CI that timed out on 8% of PRs with no documented recovery, and `main` carried
1,102 findings nobody was acting on, because the gate rates only new code. PR
decoration still reports on every push, so the signal survives without an agent
waiting on it.

Bypass: launch the session with the env var set (`CLAUDE_SKIP_SAFETY=1 claude`).
A command-string prefix is deliberately NOT honored: a PreToolUse hook runs
before the shell, and anything typed into the command is within an agent's
reach — honoring it would make the whole gate self-bypassable. The launch-time
var and the GitHub UI are the two paths only a human holds.
"""
import json
import os
import re
import subprocess
import sys
import unicodedata

HOOKS_DIR = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HOOKS_DIR)

import merge_command  # noqa: E402


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


REVIEW_MARKER = re.compile(r"<!--\s*ship-review:\s*pass\s+sha=([0-9a-f]{40})\s*-->")
# `/spec-draft-pr` names the branch `<type>/spec-<slug>` and keeps that name
# through `/implement`. The name alone is not enough — `chore/spec-lifecycle-gates`
# matches it by accident — so the gate also requires a spec-lifecycle commit
# headline, which only a real spec PR carries. Non-spec PRs stay unaffected.
SPEC_BRANCH = re.compile(r"^[a-z]+/spec-", re.IGNORECASE)
SPEC_COMMIT = re.compile(r"add spec for|remove implemented spec", re.IGNORECASE)
DEVIATIONS_HEADING = re.compile(r"^\s{0,3}#{1,6}\s+Deviations from spec\b", re.IGNORECASE | re.MULTILINE)
# perf: and refactor: change code users run as much as feat:/fix: do (#5055).
REACH_PREFIX = re.compile(r"^(feat|fix|perf|refactor)(\([^)]*\))?!?:", re.IGNORECASE)
QUOTE_LIMIT = 120
# Controls, format characters (bidi, zero-width, tag characters that can
# hide text from a reader) and line separators, plus backtick look-alikes.
UNSAFE_QUOTE_CATEGORIES = frozenset({"Cc", "Cf", "Co", "Cn", "Zl", "Zp"})
UNSAFE_QUOTE_CHARS = frozenset("`\uff40\u02cb")
REACH_HEADING = re.compile(r"^ {0,3}(#{1,6})[ \t]+Who else this reaches\b.*$", re.IGNORECASE | re.MULTILINE)
REACH_PLACEHOLDER = re.compile(r"^(tbd|todo|n/?a|none|-|\.\.\.)?$", re.IGNORECASE)
TABLE_SEPARATOR = re.compile(r"^(?=.*\|)\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?$")
REACH_SOURCE_ROOTS = ("src/", "web/src/")
REACH_EXCLUDED_ROOTS = ("src/test/", "web/src/test/")
CHANGELOG_DIR = "web/src/pages/WhatsNewPage/changelog/"
REACH_EXCLUDED_PARTS = (
    ".test.",
    ".spec.",
    "/__tests__/",
    "/__snapshots__/",
    "/fixtures/",
    "/__fixtures__/",
    "_mock/",
    "/setupTests.",
)
# `gh pr view --json author` reports the bot as `app/dependabot`; the GitHub UI
# and the REST API spell it `dependabot[bot]`. Accept both so the review-marker
# exemption actually fires (#4555).
DEPENDABOT_LOGINS = frozenset({"dependabot[bot]", "app/dependabot"})


def is_dependabot(login):
    return login in DEPENDABOT_LOGINS


def is_gh_pr_merge(cmd):
    return merge_command.is_gh_pr_merge(cmd)


def extract_pr_ref(cmd):
    return merge_command.extract_pr_ref(cmd)


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
         "number,title,headRefOid,headRefName,body,author,files,commits,statusCheckRollup,reviews,comments"],
        "pr view",
    )
    if stdout is None:
        return None
    try:
        return json.loads(stdout)
    except json.JSONDecodeError:
        sys.stderr.write("[check-merge-status] could not parse gh JSON; allowing merge.\n")
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


def is_spec_branch(head_ref_name):
    return bool(SPEC_BRANCH.match(head_ref_name or ""))


def has_spec_commit(commits):
    for commit in commits or []:
        if SPEC_COMMIT.search(commit.get("messageHeadline") or ""):
            return True
    return False


def came_from_spec(pr_data):
    return is_spec_branch(pr_data.get("headRefName")) and has_spec_commit(
        pr_data.get("commits")
    )


def has_deviations_heading(body):
    return bool(DEVIATIONS_HEADING.search(body or ""))


def deviations_violation(pr_data):
    if not came_from_spec(pr_data):
        return None
    if has_deviations_heading(pr_data.get("body")):
        return None
    return (
        "branch came from a spec PR (`<type>/spec-<slug>`) but the body has no "
        "`## Deviations from spec` heading — list every place the code departs "
        "from the spec (or write 'None — matches the spec'); see the engineer "
        "PR template"
    )


def as_text(value):
    return value if isinstance(value, str) else ""


def entries(value):
    return [entry for entry in value if isinstance(entry, dict)] if isinstance(value, list) else []


def reach_headline(pr_data):
    headlines = [as_text(pr_data.get("title"))]
    headlines += [as_text(c.get("messageHeadline")) for c in entries(pr_data.get("commits"))]
    for headline in headlines:
        if REACH_PREFIX.match(headline.strip()):
            return headline.strip()
    return None


def quote_untrusted(text):
    # The title and paths are PR-author text and the deny reason is read by
    # the agent that ran the merge, so keep them to one short inert line.
    cleaned = "".join(
        " " if ch in UNSAFE_QUOTE_CHARS or unicodedata.category(ch) in UNSAFE_QUOTE_CATEGORIES else ch
        for ch in text[: QUOTE_LIMIT * 8]
    )
    flat = " ".join(cleaned.split())
    if len(flat) > QUOTE_LIMIT:
        return flat[:QUOTE_LIMIT] + "..."
    return flat


def is_changelog_entry(path):
    return path.startswith(CHANGELOG_DIR) and path.endswith(".json")


def is_reach_source(path):
    if not path.startswith(REACH_SOURCE_ROOTS):
        return False
    if path.startswith(REACH_EXCLUDED_ROOTS) or is_changelog_entry(path) or path.endswith(".md"):
        return False
    return not any(part in path for part in REACH_EXCLUDED_PARTS)


def strip_html_comments(text):
    kept = []
    position = 0
    while True:
        opener = text.find("<!--", position)
        if opener == -1:
            kept.append(text[position:])
            return "".join(kept).replace("-->", "")
        kept.append(text[position:opener])
        closer = text.find("-->", opener + 4)
        if closer == -1:
            return "".join(kept).replace("-->", "")
        position = closer + 3


def reach_section_text(body):
    visible = strip_html_comments(as_text(body))
    heading = REACH_HEADING.search(visible)
    if heading is None:
        return None
    rest = visible[heading.end():]
    level = len(heading.group(1))
    next_heading = re.search(rf"^ {{0,3}}#{{1,{level}}}[ \t]", rest, re.MULTILINE)
    section = rest[: next_heading.start()] if next_heading else rest
    return section.strip()


def is_table_separator(line):
    return bool(TABLE_SEPARATOR.match(line))


def reach_content_lines(section):
    lines = [line.strip() for line in section.splitlines()]
    kept = []
    for index, line in enumerate(lines):
        if is_table_separator(line):
            continue
        next_line = lines[index + 1] if index + 1 < len(lines) else ""
        if is_table_separator(next_line):
            continue
        kept.append(line.lstrip("-*+ ").strip())
    return kept


def is_placeholder_cell(cell):
    bare = cell.strip().strip("*_`").strip()
    if bare != "...":
        bare = bare.rstrip(".")
    return bool(REACH_PLACEHOLDER.match(bare))


def is_placeholder_line(line):
    return all(is_placeholder_cell(cell) for cell in line.split("|"))


def has_reach_section(body):
    section = reach_section_text(body)
    if section is None:
        return False
    return any(not is_placeholder_line(line) for line in reach_content_lines(section))


def reach_violation(pr_data):
    trigger = reach_headline(pr_data)
    if trigger is None:
        return None
    paths = [as_text(f.get("path")) for f in entries(pr_data.get("files"))]
    source_paths = [p for p in paths if is_reach_source(p)]
    if not source_paths:
        return None
    if has_reach_section(pr_data.get("body")):
        return None
    number = pr_data.get("number") or "<n>"
    return (
        f"the title or a commit headline (`{quote_untrusted(trigger)}`) is "
        "feat:/fix:/perf:/refactor: and the PR changes source "
        f"(`{quote_untrusted(source_paths[0])}`), but the `## Who else this reaches` "
        "section is missing or empty (TBD/TODO/N/A/None, empty cells and comments do not count). "
        "Add one row per population the changed code is reachable from "
        "(signed-out, free, free over the limit, paying, pass holder, Auto Sync, "
        "flag on/off and each experiment arm, Notion vs upload, web/MCP/iOS): a "
        "reachable row names the test that exercises it, an unreachable row says "
        "why. Rule: .claude/agents/engineer.md step 10; rows: uncomment the table "
        "in the `## Who else this reaches` block of that file's PR description "
        f"template. Save the body (`gh pr view {number} --json body --jq .body > "
        f"<scratchpad>/ship-body-{number}.txt`), add the section, `gh pr edit "
        f"{number} --body-file <scratchpad>/ship-body-{number}.txt`, rerun the "
        "/ship step 2 reach reviewer on that file (fix what it blocks on), then "
        "merge again"
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

    if merge_command.is_graphql_merge(cmd):
        deny(
            "Refusing a GraphQL mergePullRequest mutation — no PR number to gate on. "
            "Merge through /ship with `gh pr merge <n>`."
        )

    pr_ref = extract_pr_ref(cmd)
    pr_data = fetch_pr_data(pr_ref)
    if pr_data is None:
        allow()

    rollup = pr_data.get("statusCheckRollup") or []
    files = pr_data.get("files") or []
    author = (pr_data.get("author") or {}).get("login", "")

    violations = classify(rollup, files)

    if not is_dependabot(author):
        marker_violation = review_marker_violation(pr_data)
        if marker_violation:
            violations.append(marker_violation)

    spec_violation = deviations_violation(pr_data)
    if spec_violation:
        violations.append(spec_violation)

    population_violation = reach_violation(pr_data)
    if population_violation:
        violations.append(population_violation)

    if violations:
        bullet_list = "\n".join(f"  - {v}" for v in violations)
        deny(
            "Refusing `gh pr merge` — the merge gate is not satisfied:\n"
            f"{bullet_list}\n\n"
            "Every rollup entry must be COMPLETED and non-FAILURE, every test "
            "job must have actually RUN, dependency changes need a SUCCESS test run, "
            "the review agent must have passed the head SHA, and a "
            "feat:/fix:/perf:/refactor: PR touching source must say who else it reaches.\n"
            "Human bypass: merge from the GitHub UI, or relaunch with CLAUDE_SKIP_SAFETY=1 set at launch."
        )

    allow()


if __name__ == "__main__":
    main()
