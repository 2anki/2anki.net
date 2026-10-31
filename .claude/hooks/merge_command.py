#!/usr/bin/env python3
"""
Shared code for the four merge-gate hooks. This deliberately narrows what the
hooks accept (#5193): rounds of shell-parsing fixes kept finding forms where
the PR the gate read was not the PR that merged, or where a merge was not seen
at all, so detection fails closed and only one exact command form passes.

`is_gh_pr_merge`: a Bash command is a merge attempt when it contains `gh` (or
`github`, for curl to the API) and `merge`, case-insensitive and anywhere (inside `eval`, `bash -c`, heredocs,
redirections and quotes too), checked on the raw command and again with
quotes, backslashes and backslash-newlines removed, so `"g"h pr "mer"ge` counts.
This also catches commands that only mention a merge (`gh pr view --json
mergeStateStatus`, a commit message that names `gh` and `merge` in one `-m`);
those are denied too. Keep `gh` and `merge` out of one non-merge command, for
example by writing a commit message with `git commit -F <file>`.

`allowed_merge`: the only command that passes is the one `/ship` runs, the
whole trimmed command matching `gh pr merge <n> --repo 2anki/server --squash`
(or `--repo 2anki/2anki.net`), optionally followed by ` 2>&1`. Nothing may
precede or follow it. The number and repo come only from that match; the
hooks pass that repo literal to `gh pr view -R`, deny when `gh pr view` fails,
deny when its `url` is not `https://github.com/2anki/2anki.net/pull/<n>` for
that number, and (`deny_on_error`) deny when anything after detection raises,
because a hook that crashes lets the merge through.

Words assembled at run time fail closed too: a command that contains `merge`
and any `$` or backtick (`$(echo gh) pr merge`, `g$''h pr merge`) is a merge
attempt, and so is any command containing an ANSI-C quote `$'`, since `merge`
itself can be encoded (`$'\\x6derge'`). There is no decoder; a false positive
only denies with the allowed-form message. Known limitation: a merge run
from a script file, another language or a gh alias defined earlier, where
the Bash command shows neither word nor a `$'`, is not seen. That is a policy
violation, like `CLAUDE_SKIP_SAFETY`, not a hook gap.

`changed_files` is the file list all four hooks gate on. `gh pr view --json
files` stops at a PR's first 100 files (#5172), so the list comes from the
paginated REST endpoint for 2anki/2anki.net: exact names, up to the 3000 files
GitHub returns, no diff-size limit. It is merged with the view's files, so it
never holds less than the view did, and it is complete only when it covers
every view file and is under GitHub's 3000-file cap; when the REST call fails
the view's files are returned and each hook falls back to what it checked
before.
"""
import json
import re
import subprocess
import sys

OBFUSCATION = re.compile(r"\\\n|[\"'\\]")
CANONICAL_REPO = "2anki/2anki.net"
ALLOWED_MERGE = re.compile(r"gh pr merge ([1-9][0-9]{0,8}) --repo (2anki/server|2anki/2anki\.net) --squash(?: 2>&1)?")
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


def names_gh_and_merge(text):
    lowered = text.lower()
    return ("gh" in lowered or "github" in lowered) and "merge" in lowered


def is_built_at_run_time(cmd, normalized):
    return "$'" in cmd or ("merge" in normalized.lower() and ("$" in cmd or "`" in cmd))


def is_gh_pr_merge(cmd):
    if not isinstance(cmd, str):
        return False
    normalized = OBFUSCATION.sub("", cmd)
    return names_gh_and_merge(cmd) or names_gh_and_merge(normalized) or is_built_at_run_time(cmd, normalized)


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
        f"Refusing this command: it contains `gh` and `merge`, and the merge hooks accept only "
        f"the merge /ship runs, exactly `{ALLOWED_FORM}` (or `--repo {CANONICAL_REPO}`), alone in "
        "the Bash call. Every other form is denied: a branch, a URL, another repo, extra flags, "
        "a prefix, a chained or nested command, an API or GraphQL merge. If this is not a merge, "
        "keep `gh` and `merge` out of one command (write a commit message with `git commit -F <file>`)."
    )


def deny_on_error(gate, cmd, deny):
    """Run a hook's gate for a detected merge; an exception denies instead of crashing open."""
    try:
        gate(cmd)
    except Exception as exc:
        deny(
            f"Refusing this merge: the merge gate failed ({type(exc).__name__}) before it could "
            "check the PR, and a failed gate does not let a merge through. Run the merge again."
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
    if f"{owner}/{repo}" != CANONICAL_REPO:
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
