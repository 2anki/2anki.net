#!/usr/bin/env python3
"""
Shared matcher for the four merge-gate hooks: does this Bash command *run*
`gh pr merge`, as opposed to merely mentioning it?

A mention inside a commit message, a heredoc'd doc edit, or an echo used to
trip every gate (2026-08-26: two doc-edit commands were denied as hard-rail
merges). Heredoc bodies and quoted literals are stripped first; whatever is
left is real shell, so any remaining occurrence counts — `then gh pr merge`,
`exec gh pr merge`, and backtick substitution all match (a command-position
anchor missed those, per the PR #4244 security review).

The REST merge endpoint (`gh api -X PUT repos/o/r/pulls/N/merge`, or curl to
the same URL) and the GraphQL `mergePullRequest` mutation count too. Those two
are matched with quotes kept (the URL is often quoted) but heredoc bodies
stripped, so a script that merely mentions the path is not a merge — it was used once, on 2026-08-26, to merge #4244 on
Alexander's instruction after the hook (correctly) refused the rail PR, and that
is exactly the path an agent must not have.

Known limitation: `bash -c "gh pr merge 1"` hides the merge inside a quoted
literal and is not matched. That is a policy violation, not a hook gap.

`changed_files` is the file list all four merge hooks gate on.
`gh pr view --json files` stops at a PR's first 100 files (#5172), so the
list comes from the paginated REST endpoint instead: exact names, up to the
3000 files GitHub returns, no diff-size limit. It is merged with the view's
files, so it never holds less than the view did; when the REST call fails
the view's files are returned and each hook falls back to what it checked
before.
"""
import json
import re
import subprocess
import sys

HEREDOC = re.compile(r"<<-?\s*(['\"]?)(\w+)\1[^\n]*\n.*?^\s*\2\s*$", re.S | re.M)
QUOTED_LITERAL = re.compile(r"'[^']*'|\"(?:\\.|[^\"\\])*\"")
GH_PR_MERGE = re.compile(r"\bgh\s+pr\s+merge\b")
API_MERGE_PATH = re.compile(r"\bpulls/(\d+)/merge\b")
API_WRITE_SIGNAL = re.compile(
    r"(?:-X|--method|--request)[= ]*PUT\b|(?:^|\s)(?:-f|-F|--input|--raw-field|--field)\b"
)
GRAPHQL_MERGE = re.compile(r"\bmergePullRequest\b")
PR_URL = re.compile(r"https?://github\.com/[^/]+/[^/]+/pull/(\d+)")


def strip_heredocs(cmd):
    return HEREDOC.sub("", cmd)


def strip_literals(cmd):
    return QUOTED_LITERAL.sub("", strip_heredocs(cmd))


def is_api_merge(cmd):
    shell = strip_heredocs(cmd)
    return bool(API_MERGE_PATH.search(shell) and API_WRITE_SIGNAL.search(shell))


def is_graphql_merge(cmd):
    return bool(GRAPHQL_MERGE.search(strip_heredocs(cmd)))


def is_gh_pr_merge(cmd):
    return bool(
        GH_PR_MERGE.search(strip_literals(cmd))
        or is_api_merge(cmd)
        or is_graphql_merge(cmd)
    )


def extract_pr_ref(cmd):
    """PR number the command merges, or None when `gh pr merge` targets the current branch."""
    if is_api_merge(cmd):
        return API_MERGE_PATH.search(strip_heredocs(cmd)).group(1)
    parts = GH_PR_MERGE.split(strip_literals(cmd), 1)
    if len(parts) < 2:
        return None
    after = re.split(r"[;&|]", parts[1], maxsplit=1)[0]
    url_match = PR_URL.search(after)
    if url_match:
        return url_match.group(1)
    for token in after.split():
        if token.isdigit():
            return token
    return None


CANONICAL_REPO = "2anki/2anki.net"
REST_FILES_TIMEOUT_SECONDS = 20
REST_FILES_JQ = ".[] | [.filename, .status, .additions, .deletions] | @json"
REST_STATUS_TO_CHANGE_TYPE = {
    "added": "ADDED",
    "removed": "DELETED",
    "modified": "MODIFIED",
    "renamed": "RENAMED",
    "copied": "COPIED",
    "changed": "CHANGED",
    "unchanged": "UNCHANGED",
}


def pr_number(pr_data, pr_ref):
    for candidate in (pr_data.get("number"), pr_ref):
        if isinstance(candidate, bool):
            continue
        text = str(candidate) if isinstance(candidate, int) else candidate
        if isinstance(text, str) and text.isdigit():
            return text
    return None


def rest_files_args(number):
    return [
        "gh", "api", "--paginate",
        f"repos/{CANONICAL_REPO}/pulls/{number}/files?per_page=100",
        "--jq", REST_FILES_JQ,
    ]


def parse_rest_line(line):
    row = json.loads(line)
    if not (isinstance(row, list) and len(row) == 4 and isinstance(row[0], str) and isinstance(row[1], str)):
        raise ValueError("unexpected REST file row")
    path, status, additions, deletions = row
    return {
        "path": path,
        "changeType": REST_STATUS_TO_CHANGE_TYPE.get(status, status.upper()),
        "additions": additions,
        "deletions": deletions,
    }


def fetch_rest_files(number, tag):
    try:
        result = subprocess.run(
            rest_files_args(number),
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            timeout=REST_FILES_TIMEOUT_SECONDS,
        )
    except (subprocess.TimeoutExpired, OSError) as exc:
        sys.stderr.write(f"{tag} could not list the PR's files over REST ({exc}); using gh pr view's.\n")
        return None
    if result.returncode != 0:
        sys.stderr.write(
            f"{tag} REST file list failed; using gh pr view's. "
            f"stderr: {result.stderr.strip()[:300]}\n"
        )
        return None
    try:
        return [parse_rest_line(line) for line in result.stdout.splitlines() if line.strip()]
    except ValueError:
        sys.stderr.write(f"{tag} could not parse the REST file list; using gh pr view's.\n")
        return None


def view_files(pr_data):
    files = pr_data.get("files")
    if not isinstance(files, list):
        return []
    return [entry for entry in files if isinstance(entry, dict)]


def changed_files(pr_data, pr_ref, tag):
    """(files, complete): every changed file, or gh pr view's files and False when REST fails."""
    viewed = view_files(pr_data)
    number = pr_number(pr_data, pr_ref)
    listed = fetch_rest_files(number, tag) if number is not None else None
    if listed is None:
        return viewed, False
    listed_paths = {entry["path"] for entry in listed}
    return listed + [entry for entry in viewed if entry.get("path") not in listed_paths], True
