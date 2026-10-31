#!/usr/bin/env python3
"""
Threat model: these hooks guard against an agent merging a PR by accident or
without a review. They do not guard against a determined adversary who already
has a shell, who could call the GitHub merge API with curl and a token; no
string scan stops that. The deny-by-default allowlist (`allowed_merge`) is the
control. Obfuscation detection is best effort on top of it; every form the
#5193 security reviews flagged is denied and tested, and further
string-obfuscation findings are accepted residuals, not fixed here.

Shared code for the four merge-gate hooks. Only one exact merge form passes
(#5193): rounds of shell-parsing fixes kept finding forms where the PR the gate
read was not the PR that merged, so the gate does not parse merges; it
recognises the one `/ship` runs and denies every other merge attempt.

`is_gh_pr_merge` decides what counts as a merge attempt (`MERGE_RULES`; the
first rule that fires is named in the deny). Narrowed on 2026-10-31 at
Alexander's ask, because the #5193 rule (`gh` or `github` anywhere plus `merge`
anywhere, or either one with any `$`) refused ordinary reads, PR bodies and
commit messages. Each rule runs on the raw command and again with quotes,
backslashes and backslash-newlines removed, so `"g"h pr "mer"ge` counts:

- `gh` (or a path ending in `/gh`) runs as a command, and `merge` appears as a
  whole word anywhere in the command. `merged`, `mergeable`, `mergeStateStatus`
  and `merge-base` are not the word (gh has no `merge-` subcommand). `gh` runs
  when it is the first word of a segment split on `;`, `&&`, `||`, `|`, `&`,
  newline, parentheses and backticks, after assignments, redirections and
  keywords such as `if` or `{`; or anywhere after a wrapper (`eval`, `sudo`,
  `env`, `xargs`, a shell, so `bash -c` counts).
- `mergePullRequest` anywhere, or `merge` with `pulls/`, `graphql` or a
  `curl`/`wget`/`http` command, so an API merge sent without `gh` stays caught.
- A `$` or backtick together with `merge`, `gh api`, `gh alias` or a `pulls/`
  path (`$(echo gh) pr merge`, `g$''h pr merge`, `pulls/1/${WORD}`).
- Targeted, for shapes that hide `merge` itself: a `$` or backtick in the word
  after `gh`, `pr` or `api`, flags skipped (`gh pr me$x`, `gh pr $'\\x6derge'`),
  and an ANSI-C quote as the command name.

A `$` elsewhere is fine (`gh pr view "$B"`, `--body "$(cat f.md)"`), and so is
a path under `github.com`. A commit message passes unless `gh` also runs in
the same command.

`allowed_merge`: the only command that passes is the one `/ship` runs, the
whole trimmed command matching `gh pr merge <n> --repo 2anki/server --squash`
(or `--repo 2anki/2anki.net`), optionally followed by ` 2>&1`. Nothing may
precede or follow it. The number and repo come only from that match; the
hooks pass that repo literal to `gh pr view -R`, deny when `gh pr view` fails,
deny when its `url` is not `https://github.com/2anki/2anki.net/pull/<n>` for
that number, and (`deny_on_error`) deny when anything after detection raises,
because a hook that crashes lets the merge through.

There is no decoder; a false positive is denied with a message naming the rule
that fired and its fix (`trigger_reason`). Known limitation: a merge run from a
script file, another language, a gh alias defined earlier, a word rebuilt by a
pipe (`echo egrem | rev | xargs ...`) or a glob (`gh pr m[e]rge`) is not seen.
That is a policy violation, like `CLAUDE_SKIP_SAFETY`, not a hook gap.

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
MERGE_WORD = re.compile(r"\bmerge\b(?!-)", re.I)
SEGMENT_SEPARATOR = re.compile(r"&&|\|\||(?<![<>])&(?!>)|[;|\n()`]")
ASSIGNMENT = re.compile(r"[A-Za-z_][A-Za-z0-9_]*=")
REDIRECTION = re.compile(r"[0-9]*(?:&>>?|>&|<&|>>?|<<<|<<-?|<>|<)(.*)", re.S)
LEADING_KEYWORDS = frozenset({"!", "{", "}", "if", "then", "else", "elif", "do", "while", "until", "time"})
WRAPPERS = frozenset({
    "eval", "sudo", "doas", "env", "xargs", "exec", "command", "builtin", "nohup", "time", "nice",
    "ionice", "timeout", "stdbuf", "watch", "caffeinate", "script", "unbuffer", "chronic", "setsid",
    "flock", "find", "parallel", "ssh", "npx", "pnpm", "yarn", "bunx",
    "bash", "sh", "zsh", "dash", "ksh", "fish", "csh", "tcsh",
})
API_CLIENTS = frozenset({"curl", "wget", "http", "https", "xh"})
API_PATHS = ("pulls/", "graphql")
FLAGS_BEFORE_WORD = r"(?:-\S*\s+(?:[^\s-]\S*\s+)?)*"
RUNTIME_SUBCOMMAND = re.compile(
    r"(?:^|[\s;&|()`/])(?:gh|pr|api)(?:\s+" + FLAGS_BEFORE_WORD + r"\S*)?[$`]", re.I
)
GH_API_OR_ALIAS = re.compile(r"(?:^|[\s;&|()`/])gh\s+" + FLAGS_BEFORE_WORD + r"(?:api|alias)\b", re.I)
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


def program_name(token):
    return token.rsplit("/", 1)[-1].lower()


def command_word_index(tokens):
    index = 0
    while index < len(tokens):
        token = tokens[index]
        redirection = REDIRECTION.fullmatch(token)
        if redirection is not None:
            index += 1 if redirection.group(1) else 2
        elif ASSIGNMENT.match(token) or token.lower() in LEADING_KEYWORDS:
            index += 1
        else:
            return index
    return None


def runs_program(text, programs):
    for segment in SEGMENT_SEPARATOR.split(text):
        tokens = segment.split()
        index = command_word_index(tokens)
        if index is None:
            continue
        name = program_name(tokens[index])
        if name in programs:
            return True
        if name in WRAPPERS and any(program_name(token) in programs for token in tokens[index + 1:]):
            return True
    return False


def has_ansi_c_command_word(cmd, normalized):
    for segment in SEGMENT_SEPARATOR.split(cmd):
        tokens = segment.split()
        index = command_word_index(tokens)
        if index is not None and "$'" in tokens[index]:
            return True
    return False


def names_merge(cmd, normalized):
    return bool(MERGE_WORD.search(cmd) or MERGE_WORD.search(normalized))


def runs_gh_with_merge(cmd, normalized):
    return names_merge(cmd, normalized) and (runs_program(cmd, {"gh"}) or runs_program(normalized, {"gh"}))


def names_merge_mutation(cmd, normalized):
    return "mergepullrequest" in normalized.lower()


def sends_merge_to_api(cmd, normalized):
    if not names_merge(cmd, normalized):
        return False
    lowered = normalized.lower()
    return any(path in lowered for path in API_PATHS) or runs_program(normalized, API_CLIENTS)


def is_built_at_run_time(cmd, normalized):
    if "$" not in cmd and "`" not in cmd:
        return False
    return (
        names_merge(cmd, normalized)
        or bool(GH_API_OR_ALIAS.search(normalized))
        or "pulls/" in normalized.lower()
    )


def builds_subcommand_at_run_time(cmd, normalized):
    return bool(RUNTIME_SUBCOMMAND.search(cmd) or RUNTIME_SUBCOMMAND.search(normalized))


MERGE_RULES = (
    (
        runs_gh_with_merge,
        "it runs `gh` and contains the word `merge`",
        "keep `merge` out of a command that runs `gh`: pass a PR body with `--body-file` and run the "
        "`gh` call on its own",
    ),
    (
        names_merge_mutation,
        "it contains `mergePullRequest`, the GraphQL merge mutation",
        "keep `mergePullRequest` out of the command (search for it with a pattern such as `mergePull`)",
    ),
    (
        sends_merge_to_api,
        "it contains `merge` next to `pulls/`, `graphql`, or a `curl`, `wget` or `http` call",
        "keep `merge` out of a command that calls an API",
    ),
    (
        is_built_at_run_time,
        "it pairs `merge`, `gh api`, `gh alias` or a `pulls/` path with a `$` or a backtick",
        "write the value literally, or pass text that names `merge` with `--body-file`",
    ),
    (
        builds_subcommand_at_run_time,
        "a `$` or backtick builds the subcommand after `gh`, `pr` or `api`",
        "write the subcommand literally; a `$` in a later argument, as in `gh pr view \"$B\"`, is fine",
    ),
    (
        has_ansi_c_command_word,
        "the command name is an ANSI-C quote (`$'…'`)",
        "write the command name literally",
    ),
)


def fired_rule(cmd):
    normalized = OBFUSCATION.sub("", cmd)
    for rule in MERGE_RULES:
        if rule[0](cmd, normalized):
            return rule
    return None


def is_gh_pr_merge(cmd):
    if not isinstance(cmd, str):
        return False
    return fired_rule(cmd) is not None


def allowed_merge(cmd):
    """(number, repo) when the command is exactly the merge /ship runs, else None."""
    if not isinstance(cmd, str):
        return None
    match = ALLOWED_MERGE.fullmatch(cmd.strip(" \n"))
    return (match.group(1), match.group(2)) if match else None


def trigger_reason(cmd):
    rule = fired_rule(cmd)
    if rule is None:
        return ("it is not the merge /ship runs", "run that merge exactly as written")
    return rule[1], rule[2]


def merge_form_violation(cmd):
    if allowed_merge(cmd) is not None:
        return None
    reason, fix = trigger_reason(cmd)
    return (
        f"Refusing this command: {reason}, so the merge hooks treat it as a merge attempt, and "
        f"they accept only the merge /ship runs, exactly `{ALLOWED_FORM}` (or `--repo "
        f"{CANONICAL_REPO}`), alone in the Bash call. If this is not a merge, {fix}."
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
