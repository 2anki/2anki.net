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
do flags between the words on one line (`gh pr -R o/r merge`). The command is
also split into words the way the shell does (`shlex`, backslash-newlines
removed), and every `gh` word (any case, any path) is followed the way cobra
picks subcommands: a flag without `=` that is not `-h`/`--help`/`--version`
takes the next word as its value. If the group word is `pr` and the action word
is `merge`, it is a merge; a word built with `$` or a backtick where gh, the
group or the action would be counts as all three, and so does `gh pr` with no
action (`xargs gh pr`). A quoted mention inside another command's argument is
one word and does not count; a command shlex cannot split counts when it
contains `gh` and `merge`. `gh alias set|import` with `merge` in its expansion,
the REST merge endpoint (`gh api -X PUT repos/o/r/pulls/N/merge`, or curl to the
same URL, read both raw and as shell words), the GraphQL `mergePullRequest`
mutation and a GraphQL query read from a file count too, and the argument of
`eval` or of `bash|sh|zsh|dash|ksh -c` is checked the same way.

Known limitations, policy violations rather than hook gaps: a merge run
through anything the hook cannot read as shell words, such as a script file,
another language (`python -c "os.system(...)"`), a heredoc fed to a shell, a
gh alias defined in an earlier call, or a shell function or alias from the
user's profile.

`allowed_merge`: the only merge the hooks let through is the one `/ship` runs,
exactly `gh pr merge <n> --repo 2anki/server --squash` (or `--repo
2anki/2anki.net`), alone in the Bash call. Every other detected merge is denied:
a branch, `#N`, a URL, another repo, extra or clustered flags, `GH_REPO=` or
`cd` prefixes, chained commands, API and GraphQL merges. Parsing gh's argument
grammar kept growing edge cases where the PR the gate read was not the PR that
merged (#5193 security reviews); an exact form removes the differential. The
hooks pass the matched repo literal, never a raw token, to `gh pr view -R`,
deny when `gh pr view` fails, deny when its `url` is not
`https://github.com/2anki/2anki.net/pull/<n>` for that number, and
(`deny_on_error`) deny when anything after detection raises, because a hook
that crashes lets the merge through.

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
import shlex
import subprocess
import sys

HEREDOC = re.compile(r"<<-?\s*(['\"]?)(\w+)\1[^\n]*\n.*?^\s*\2\s*$", re.S | re.M)
QUOTED_LITERAL = re.compile(r"'[^']*'|\"(?:\\.|[^\"\\])*\"")
GH_PR_MERGE = re.compile(r"\bgh(?:[ \t]+[^\s;&|]+)*?[ \t]+pr(?:[ \t]+[^\s;&|]+)*?[ \t]+merge\b")
API_MERGE_PATH = re.compile(r"\bpulls/[^/\s]+/merge\b")
API_WRITE_SIGNAL = re.compile(
    r"(?:-X|--method|--request)[= ]*PUT\b|(?:^|\s)(?:-f|-F|--input|--raw-field|--field)\b"
)
GRAPHQL_MERGE = re.compile(r"\bmergePullRequest\b")
BOOL_FLAGS = frozenset({"-h", "--help", "--version"})
SHELLS = frozenset({"bash", "sh", "zsh", "dash", "ksh"})

CANONICAL_REPO = "2anki/2anki.net"
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
    lexer = shlex.shlex(strip_heredocs(cmd).replace("\\\n", ""), posix=True, punctuation_chars=";&|")
    lexer.whitespace_split = True
    return list(lexer)


def is_computed(word):
    return "$" in word or "`" in word


def is_gh_word(word):
    return is_computed(word) or word.strip("()").rsplit("/", 1)[-1].lower() == "gh"


def cobra_word(words, start):
    """Index of the word cobra takes as the next subcommand, or None when a computed word makes it unknowable."""
    index = start
    while index < len(words):
        word = words[index]
        if is_computed(word):
            return None
        if word == "--" or not word.startswith("-"):
            return index + 1 if word == "--" else index
        takes_value = "=" not in word and word not in BOOL_FLAGS and (word.startswith("--") or len(word) == 2)
        index += 2 if takes_value else 1
    return len(words)


def is_word(words, index, expected):
    if index is None or index >= len(words):
        return True
    return is_computed(words[index]) or words[index].lower() in expected


def runs_gh_merge(words):
    for index, word in enumerate(words):
        if not is_gh_word(word):
            continue
        group = cobra_word(words, index + 1)
        if group is not None and group < len(words) and words[group].lower() == "alias":
            if any("merge" in later.lower() for later in words[group + 1:]):
                return True
            continue
        if group is not None and group >= len(words):
            continue
        if not is_word(words, group, {"pr"}):
            continue
        action = None if group is None else cobra_word(words, group + 1)
        if is_word(words, action, {"merge"}):
            return True
    return False


def nested_commands(words):
    for index, word in enumerate(words[:-1]):
        name = word.rsplit("/", 1)[-1]
        if name == "eval" or (name == "-c" and index > 0 and words[index - 1].rsplit("/", 1)[-1] in SHELLS):
            yield words[index + 1]


def is_shell_merge(cmd, depth=0):
    try:
        words = shell_words(cmd)
    except ValueError:
        lowered = cmd.lower()
        return "merge" in lowered and "gh" in lowered
    if runs_gh_merge(words):
        return True
    joined = " ".join(words)
    if is_api_merge(joined) or is_graphql_merge(joined) or is_graphql_from_file(words):
        return True
    return depth < 3 and any(is_shell_merge(inner, depth + 1) for inner in nested_commands(words))


def is_graphql_from_file(words):
    return "graphql" in words and any("=@" in word or word == "--input" for word in words)


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
