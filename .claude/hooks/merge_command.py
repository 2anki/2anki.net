#!/usr/bin/env python3
"""
Shared code for the four merge-gate hooks.

`is_gh_pr_merge`: does this Bash command *run* `gh pr merge`, as opposed to
merely mentioning it? A mention inside a commit message, a heredoc'd doc edit,
or an echo used to trip every gate (2026-08-26: two doc-edit commands were
denied as hard-rail merges). Heredoc bodies and quoted literals are stripped
first; whatever is left is real shell, so any remaining occurrence counts —
`then gh pr merge`, `exec gh pr merge`, and backtick substitution all match (a
command-position anchor missed those, per the PR #4244 security review), and so
do flags between the words (`gh pr -R o/r merge`, a valid gh command). The
command is also split the way the shell splits it (`shlex`), so a quoted or
escaped subcommand (`gh pr "merge"`, `gh pr m\\erge`) or one built with `$` or a
backtick counts, while a quoted mention in another command's argument does
not; a command shlex cannot split counts when it contains both `gh` and
`merge`. The
REST merge endpoint (`gh api -X PUT repos/o/r/pulls/N/merge`, or curl to the
same URL) and the GraphQL `mergePullRequest` mutation count too. Known
limitation: `bash -c "gh pr merge 1"` hides the merge inside a quoted literal
and is not matched. That is a policy violation, not a hook gap.

`allowed_merge`: the only merge the hooks let through is the one `/ship` runs,
exactly `gh pr merge <n> --repo 2anki/server --squash` (or `--repo
2anki/2anki.net`), alone in the Bash call. Every other merge form is denied:
a branch, `#N`, a URL, another repo, extra or clustered flags, `GH_REPO=` or
`cd` prefixes, chained commands, API and GraphQL merges. Parsing gh's argument
grammar kept growing edge cases where the PR the gate read was not the PR that
merged (#5193 security reviews); an exact form removes the differential. The
hooks pass the matched repo literal, never a raw token, to `gh pr view -R`,
deny when `gh pr view` fails, and deny when its `url` is not that repo's PR
with that number.

`changed_files` is the file list all four hooks gate on. `gh pr view --json
files` stops at a PR's first 100 files (#5172), so the list comes from the
paginated REST endpoint for 2anki/2anki.net: exact names, up to the 3000 files
GitHub returns, no diff-size limit. It is merged with the view's files, so it
never holds less than the view did, and it is complete only when it covers
every view file and is under GitHub's 3000-file cap; when the REST call fails the view's files are returned and
each hook falls back to what it checked before.
"""
import json
import re
import shlex
import subprocess
import sys

HEREDOC = re.compile(r"<<-?\s*(['\"]?)(\w+)\1[^\n]*\n.*?^\s*\2\s*$", re.S | re.M)
QUOTED_LITERAL = re.compile(r"'[^']*'|\"(?:\\.|[^\"\\])*\"")
GH_PR_MERGE = re.compile(r"\bgh(?:\s+[^\s;&|]+)*?\s+pr(?:\s+[^\s;&|]+)*?\s+merge\b")
API_MERGE_PATH = re.compile(r"\bpulls/(\d+)/merge\b")
API_WRITE_SIGNAL = re.compile(
    r"(?:-X|--method|--request)[= ]*PUT\b|(?:^|\s)(?:-f|-F|--input|--raw-field|--field)\b"
)
GRAPHQL_MERGE = re.compile(r"\bmergePullRequest\b")
VALUE_FLAGS = frozenset({"-R", "--repo", "--hostname"})

CANONICAL_REPO = "2anki/2anki.net"
CANONICAL_REPOS = frozenset({"2anki/2anki.net", "2anki/server"})
ALLOWED_MERGE = re.compile(r"gh pr merge ([1-9][0-9]{0,8}) --repo (2anki/server|2anki/2anki\.net) --squash")
ALLOWED_FORM = "gh pr merge <n> --repo 2anki/server --squash"
VIEW_URL = re.compile(r"https://github\.com/([^/\s]+)/([^/\s]+)/pull/([0-9]+)")
REST_FILES_TIMEOUT_SECONDS = 20
REST_FILES_CAP = 3000
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


def strip_heredocs(cmd):
    return HEREDOC.sub("", cmd)


def strip_literals(cmd):
    return QUOTED_LITERAL.sub("", strip_heredocs(cmd))


def is_api_merge(cmd):
    shell = strip_heredocs(cmd)
    return bool(API_MERGE_PATH.search(shell) and API_WRITE_SIGNAL.search(shell))


def is_graphql_merge(cmd):
    return bool(GRAPHQL_MERGE.search(strip_heredocs(cmd)))


def shell_words(cmd):
    lexer = shlex.shlex(strip_heredocs(cmd), posix=True, punctuation_chars=True)
    lexer.whitespace_split = True
    return list(lexer)


def skip_flags(words, start):
    index = start
    while index < len(words) and words[index].startswith("-"):
        index += 2 if words[index] in VALUE_FLAGS else 1
    return index


def subcommand_is_merge(word):
    return "merge" in word or "$" in word or "`" in word


def runs_gh_pr_merge(words):
    for index, word in enumerate(words):
        if word != "gh" and not word.endswith("/gh"):
            continue
        group = skip_flags(words, index + 1)
        if group >= len(words) or words[group] != "pr":
            continue
        action = skip_flags(words, group + 1)
        if action < len(words) and subcommand_is_merge(words[action]):
            return True
    return False


def is_shell_merge(cmd):
    try:
        words = shell_words(cmd)
    except ValueError:
        return "merge" in cmd and "gh" in cmd
    return runs_gh_pr_merge(words)


def is_gh_pr_merge(cmd):
    return bool(
        GH_PR_MERGE.search(strip_literals(cmd))
        or is_shell_merge(cmd)
        or is_api_merge(cmd)
        or is_graphql_merge(cmd)
    )


def allowed_merge(cmd):
    """(number, repo) when the command is exactly the merge /ship runs, else None."""
    if not isinstance(cmd, str):
        return None
    match = ALLOWED_MERGE.fullmatch(cmd.strip(" \n"))
    return (match.group(1), match.group(2)) if match else None


def merge_form_violation(cmd):
    if allowed_merge(cmd) is not None:
        return None
    return (
        f"Refusing this merge: the merge hooks only accept the command /ship runs, exactly "
        f"`{ALLOWED_FORM}` (or `--repo {CANONICAL_REPO}`), alone in the Bash call. Any other "
        "form (a branch, a URL, another repo, extra flags, a prefix, a chained command, an API "
        "or GraphQL merge) is denied, so the PR the gate reads is the PR that merges."
    )


def view_failed_violation(number):
    return (
        f"Refusing this merge: gh pr view could not read PR {number}, so the gate cannot check it. "
        "Fix gh (auth, network) and run the merge again."
    )


def pr_number(pr_data):
    candidate = pr_data.get("number")
    if isinstance(candidate, bool) or not isinstance(candidate, (int, str)):
        return None
    text = str(candidate)
    return text if text.isdigit() else None


def view_repo_reason(pr_data, number):
    url = pr_data.get("url")
    match = VIEW_URL.fullmatch(url) if isinstance(url, str) else None
    if match is None:
        return "gh pr view returned no readable PR url"
    owner, repo, viewed = match.groups()
    if f"{owner}/{repo}".lower() not in CANONICAL_REPOS:
        return f"gh pr view resolved a PR in {owner[:80]}/{repo[:80]}"
    if viewed != number:
        return f"gh pr view resolved PR {viewed}, not PR {number}"
    if pr_number(pr_data) != number:
        return "gh pr view's number and url disagree"
    return None


def view_repo_violation(pr_data, number):
    reason = view_repo_reason(pr_data, number)
    if reason is None:
        return None
    return (
        f"Refusing this merge: {reason}, so the gate cannot be sure it read the PR being "
        f"merged. Merge with `{ALLOWED_FORM}`."
    )


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
        return [parse_rest_line(line) for line in result.stdout.split("\n") if line.strip()]
    except ValueError:
        sys.stderr.write(f"{tag} could not parse the REST file list; using gh pr view's.\n")
        return None


def view_files(pr_data):
    files = pr_data.get("files")
    if not isinstance(files, list):
        return []
    return [entry for entry in files if isinstance(entry, dict)]


def changed_files(pr_data, number, tag):
    """(files, complete): every changed file, or gh pr view's files and False when REST fails."""
    viewed = view_files(pr_data)
    listed = fetch_rest_files(number, tag) if isinstance(number, str) and number.isdigit() else None
    if listed is None:
        return viewed, False
    listed_paths = {entry["path"] for entry in listed}
    missing = [entry for entry in viewed if not isinstance(entry.get("path"), str) or entry["path"] not in listed_paths]
    return listed + missing, not missing and len(listed) < REST_FILES_CAP
