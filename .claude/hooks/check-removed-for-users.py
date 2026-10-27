#!/usr/bin/env python3
"""
PreToolUse -> Bash: block `gh pr merge` when a PR removes something users see,
or changes a golden snapshot, without the PR body saying so.

Why: #4589 removed the held-back-cards notice for signed-in free users as a
side effect of an anonymous-visitor feature, and its body said the other paths
were unchanged. Purchases after that notice dropped sharply for 19 days until
#4789 restored it. Golden snapshots can be regenerated with `-u` and merged
with nobody explaining the diff.

Rule 1, removed for users. Any of these needs a filled `## Removed for users`
section in the PR body:
  - A string removed from an English locale file
    (`web/src/lib/i18n/locales/en/*.json`; en is the source of truth, so the
    other nine locales are not read). Strings are matched by key path, built
    from the object openers inside each diff hunk; when an opener sits outside
    the hunk the path is a suffix of the real one. Not counted: a key added in
    the same file at the same indentation whose path equals the removed one or
    ends with it (a copy edit, or a move within its parent); or the same value
    added in any en file (a rename or a move between namespaces). Lines over
    4000 characters are skipped.
  - A deleted `web/src/**/*.tsx` component (tests and stories excluded) whose
    name contains Notice, Warning, Banner, Alert, Callout or Toast, singular or
    plural, as a PascalCase word (`FooNotice/index.tsx` counts by its folder
    name). Not counted: a rename, or a file with the same component name that
    survives anywhere in the PR.
  - A removed `const` in `src/**/*.ts` whose UPPER_SNAKE name has a WARNING(S)
    or NOTICE(S) word (`AI_CREDITS_EXHAUSTED_WARNING_CODE`): the codes and
    texts the server sends with a conversion. Tests, `.d.ts`,
    `src/data_layer/public/`, `src/test/` and fixtures are excluded. Not
    counted: the same name declared on an added line in another checked server
    source.
Rule 2, snapshot changes. A modified, deleted or renamed file under a `golden/`
directory that is not a .ts/.tsx/.js/.mjs/.cjs source (the
`__snapshots__/*.snap` files, golden fixtures) needs a `## Snapshot changes`
section that names each changed file by its basename. Newly added files and
add-only edits (no deleted lines) do not count.

A section is empty when it holds only whitespace, HTML comments, checkboxes or
a bare placeholder, optionally followed by "for users": none, none removed, no,
n/a, not applicable, nothing, nothing removed, no change(s), no user-facing (or
user-visible) change(s), tbd, todo. A section containing `<why>` anywhere is
also empty. "None, the strings moved to X" passes: that is the out for a false
positive, and it puts the reason on the record. Every filled copy of the
heading counts, and a trailing colon on the heading is fine.

Known false positives: a string moved to another en file with a changed value,
or moved to a different nesting depth; a deleted component whose name merely
contains Alert (an AlertDialog shell); a WARNING constant that never reaches a
user (an email job interval). Known false negatives: a notice rendered inline
in a component that survives (the JSX goes, the file stays); a notice
component renamed to a name without a notice word; user-facing English
literals outside the locale files; a server warning built from a string
literal with no named constant; a removed string whose value is common enough
to be added elsewhere in en ("Cancel"); a nested string swapped for one with
the same leaf at the same depth, when an opener on either side sits outside
its hunk; a PR past the file list gh returns; and anything in a diff GitHub
refuses to serve (too large), where the string and constant checks fail open
while the file-list checks still run.

Mirrors check-changelog-on-merge.py: fetches the PR via gh, fails open on any
tooling error, exempts dependabot.
"""
import json
import os
import re
import subprocess
import sys

HOOKS_DIR = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HOOKS_DIR)

import merge_command  # noqa: E402

TAG = "[check-removed-for-users]"
EN_LOCALE_PREFIX = "web/src/lib/i18n/locales/en/"
REMOVED_SECTION = "Removed for users"
SNAPSHOT_SECTION = "Snapshot changes"
MAX_LISTED = 15
MAX_KEY_DEPTH = 16
MAX_KEY_LENGTH = 200
MAX_LISTED_KEY_LENGTH = 120
MAX_LINE_LENGTH = 4000
GH_TIMEOUT_SECONDS = 15

LOCALE_ENTRY = re.compile(r'^\s*"((?:[^"\\]|\\.)+)"\s*:\s*"((?:[^"\\]|\\.)*)",?$')
LOCALE_OPENER = re.compile(r'^\s*"((?:[^"\\]|\\.)+)"\s*:\s*\{$')
NOTICE_WORD = re.compile(r"(Notice|Warning|Banner|Alert|Callout|Toast)s?(?![a-z])")
CONST_DECL = re.compile(r"^\s*(?:export\s+)?const\s+([A-Z][A-Z0-9_]*)\b")
DIFF_HEADER = re.compile(r"diff --git a/(.+?) b/(.+)$")
WARNING_WORDS = {"WARNING", "WARNINGS", "NOTICE", "NOTICES"}
SOURCE_EXTENSIONS = (".ts", ".tsx", ".js", ".mjs", ".cjs")
PLACEHOLDERS = {
    "", "none", "no", "na", "notapplicable", "nothing", "nothingremoved",
    "noneremoved", "nochange", "nochanges", "nouserfacingchange",
    "nouserfacingchanges", "nouservisiblechange", "nouservisiblechanges",
    "tbd", "todo",
}
CHECKBOX = re.compile(r"\[[ xX]\]")
DEPENDABOT_LOGINS = {"dependabot[bot]", "app/dependabot"}


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


def run_gh(args, label):
    try:
        result = subprocess.run(
            args,
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            timeout=GH_TIMEOUT_SECONDS,
        )
    except (subprocess.TimeoutExpired, OSError) as exc:
        sys.stderr.write(f"{TAG} could not run gh ({exc}); skipping {label}.\n")
        return None
    if result.returncode != 0:
        sys.stderr.write(
            f"{TAG} {' '.join(args[:3])} failed; skipping {label}. "
            f"stderr: {result.stderr.strip()[:300]}\n"
        )
        return None
    return result.stdout


def gh_args(subcommand, pr_ref, extra):
    args = ["gh", "pr", subcommand]
    if pr_ref is not None:
        args.append(pr_ref)
    return args + extra


def fetch_pr_data(pr_ref):
    stdout = run_gh(gh_args("view", pr_ref, ["--json", "author,body,files"]), "this gate")
    if stdout is None:
        return None
    try:
        parsed = json.loads(stdout)
    except json.JSONDecodeError:
        sys.stderr.write(f"{TAG} could not parse gh JSON; allowing merge.\n")
        return None
    return parsed if isinstance(parsed, dict) else None


def fetch_diff(pr_ref):
    return run_gh(gh_args("diff", pr_ref, ["--color", "never"]), "the string and constant checks")


def is_en_locale(path):
    return isinstance(path, str) and path.startswith(EN_LOCALE_PREFIX) and path.endswith(".json")


def is_server_source(path):
    if not isinstance(path, str) or not (path.startswith("src/") and path.endswith(".ts")):
        return False
    if path.endswith(".d.ts") or ".test." in path:
        return False
    return not (
        path.startswith("src/data_layer/public/")
        or path.startswith("src/test/")
        or "/fixtures/" in path
    )


def is_web_component(path):
    if not isinstance(path, str) or not (path.startswith("web/src/") and path.endswith(".tsx")):
        return False
    return ".test." not in path and ".stories." not in path


def component_name(path):
    parts = path.split("/")
    stem = parts[-1].rsplit(".", 1)[0]
    if stem == "index" and len(parts) > 1:
        return parts[-2]
    return stem


def is_golden_snapshot(path):
    if not isinstance(path, str):
        return False
    segments = path.split("/")
    if "golden" not in segments[:-1]:
        return False
    return not path.endswith(SOURCE_EXTENSIONS)


def parse_hunks(diff_text):
    hunks = []
    old_path, new_path, current = None, None, None
    for raw in diff_text.split("\n"):
        line = raw.rstrip("\r")
        if line.startswith("diff --git "):
            match = DIFF_HEADER.match(line)
            old_path, new_path = (match.group(1), match.group(2)) if match else (None, None)
            current = None
        elif line.startswith("@@"):
            current = {"old": old_path, "new": new_path, "lines": []}
            hunks.append(current)
        elif current is not None and line[:1] in ("-", "+", " "):
            current["lines"].append((line[0], line[1:]))
    return hunks


def locale_entries(lines, side_marker):
    stack = []
    entries = []
    for marker, text in lines:
        if marker not in (" ", side_marker) or len(text) > MAX_LINE_LENGTH:
            continue
        stripped = text.rstrip()
        indent = len(stripped) - len(stripped.lstrip())
        while stack and stack[-1][0] >= indent:
            stack.pop()
        opener = LOCALE_OPENER.match(stripped)
        if opener:
            if len(stack) < MAX_KEY_DEPTH:
                stack.append((indent, opener.group(1)[:MAX_KEY_LENGTH]))
            continue
        entry = LOCALE_ENTRY.match(stripped)
        if entry and marker == side_marker:
            key_path = ".".join([key for _, key in stack] + [entry.group(1)[:MAX_KEY_LENGTH]])
            entries.append((key_path, entry.group(2), indent))
    return entries


def dotted_suffixes(key_path):
    parts = key_path.split(".")
    return [".".join(parts[start:]) for start in range(len(parts))]


def removed_locale_strings(hunks):
    removed, added_values = [], set()
    added_full, added_suffixes = set(), set()
    for hunk in hunks:
        if is_en_locale(hunk["old"]):
            removed.extend((hunk["old"], *entry) for entry in locale_entries(hunk["lines"], "-"))
        if is_en_locale(hunk["new"]):
            for key, value, indent in locale_entries(hunk["lines"], "+"):
                added_full.add((hunk["new"], indent, key))
                added_suffixes.update((hunk["new"], indent, suffix) for suffix in dotted_suffixes(key))
                added_values.add(value)
    findings = []
    for path, key, value, indent in removed:
        if value in added_values or (path, indent, key) in added_suffixes:
            continue
        if any((path, indent, suffix) in added_full for suffix in dotted_suffixes(key)):
            continue
        findings.append(f'{os.path.basename(path)}: {shorten(key, MAX_LISTED_KEY_LENGTH)} ("{shorten(value, 60)}")')
    return findings


def shorten(text, limit):
    return text if len(text) <= limit else text[: limit - 3] + "..."


def declared_warning_constants(hunks, side_marker, path_key):
    names = []
    for hunk in hunks:
        path = hunk[path_key]
        if not is_server_source(path):
            continue
        for marker, text in hunk["lines"]:
            match = CONST_DECL.match(text) if marker == side_marker else None
            if match and WARNING_WORDS & set(match.group(1).split("_")):
                names.append((path, match.group(1)))
    return names


def removed_server_warnings(hunks):
    re_declared = {name for _, name in declared_warning_constants(hunks, "+", "new")}
    return [
        f"{path}: {name}"
        for path, name in declared_warning_constants(hunks, "-", "old")
        if name not in re_declared
    ]


def removed_notice_components(files):
    surviving_names = {
        component_name(f.get("path", ""))
        for f in files
        if f.get("changeType") != "DELETED" and is_web_component(f.get("path", ""))
    }
    findings = []
    for entry in files:
        path = entry.get("path", "")
        if entry.get("changeType") != "DELETED" or not is_web_component(path):
            continue
        name = component_name(path)
        if NOTICE_WORD.search(name) and name not in surviving_names:
            findings.append(path)
    return findings


def changed_snapshots(files):
    return [
        f.get("path", "")
        for f in files
        if f.get("changeType") != "ADDED"
        and f.get("deletions") != 0
        and is_golden_snapshot(f.get("path", ""))
    ]


def needs_diff(files):
    for entry in files:
        path = entry.get("path", "")
        if entry.get("changeType") == "ADDED" or entry.get("deletions") == 0:
            continue
        if is_en_locale(path) or is_server_source(path):
            return True
    return False


def strip_html_comments(text):
    kept = []
    position = 0
    while True:
        start = text.find("<!--", position)
        if start == -1:
            kept.append(text[position:])
            break
        kept.append(text[position:start])
        end = text.find("-->", start + 4)
        if end == -1:
            break
        position = end + 3
    return "".join(kept)


def filled_sections(body, heading):
    pattern = re.compile(
        rf"^#{{2}}[ \t]+{re.escape(heading)}[ \t]*(?::[ \t]*)?\r?$\n?(.*?)(?=^#{{1,2}}[ \t]|\Z)",
        re.M | re.S | re.I,
    )
    texts = (match.group(1).strip() for match in pattern.finditer(strip_html_comments(body)))
    return [text for text in texts if is_filled(text)]


def is_filled(text):
    lowered = text.lower()
    if "<why>" in lowered:
        return False
    letters = re.sub(r"[^a-z]", "", CHECKBOX.sub("", lowered))
    return letters.removesuffix("forusers") not in PLACEHOLDERS


def listed(items):
    shown = [f"  {item}" for item in items[:MAX_LISTED]]
    if len(items) > MAX_LISTED:
        shown.append(f"  ...and {len(items) - MAX_LISTED} more")
    return "\n".join(shown)


def removal_problem(removals):
    return (
        f"It removes things users see, and the body has no filled `## {REMOVED_SECTION}` "
        "section:\n" + listed(removals) + "\n\n"
        f"  Add `## {REMOVED_SECTION}` to the PR body (`gh pr edit <n> --body-file ...`)\n"
        "  saying who loses what, and in which flow (\"signed-in free users no longer\n"
        "  see how many cards were held back on /upload\").\n"
        "  If nothing is lost (a string moved with new wording, a constant users never\n"
        "  see), write \"None, \" followed by the reason.\n\n"
        "  Why: #4589 dropped a notice for signed-in free users while its body said the\n"
        "  other paths were unchanged; purchases after that notice fell for 19 days."
    )


def snapshot_problem(snapshots):
    return (
        f"It changes golden snapshots the `## {SNAPSHOT_SECTION}` section does not "
        "explain:\n" + listed(snapshots) + "\n\n"
        f"  Add or extend `## {SNAPSHOT_SECTION}` in the PR body with one line per file,\n"
        "  naming it by basename and saying what the output now does differently and\n"
        "  why that is right.\n\n"
        "  Why: a snapshot regenerated with `-u` merges whatever the code now emits;\n"
        "  the section is the only record that someone read the new cards."
    )


def find_removals(files, pr_ref):
    removals = removed_notice_components(files)
    if not needs_diff(files):
        return removals
    diff_text = fetch_diff(pr_ref)
    if diff_text is None:
        return removals
    hunks = parse_hunks(diff_text)
    return removed_locale_strings(hunks) + removals + removed_server_warnings(hunks)


def main():
    try:
        data = json.loads(sys.stdin.read())
    except json.JSONDecodeError:
        allow()

    if data.get("tool_name") != "Bash":
        allow()

    cmd = data.get("tool_input", {}).get("command", "")
    if not merge_command.is_gh_pr_merge(cmd):
        allow()

    pr_ref = merge_command.extract_pr_ref(cmd)
    pr_data = fetch_pr_data(pr_ref)
    if pr_data is None:
        allow()

    author = pr_data.get("author")
    if isinstance(author, dict) and author.get("login") in DEPENDABOT_LOGINS:
        allow()

    raw_files = pr_data.get("files")
    files = [f for f in raw_files if isinstance(f, dict)] if isinstance(raw_files, list) else []
    raw_body = pr_data.get("body")
    body = raw_body if isinstance(raw_body, str) else ""

    problems = []
    if not filled_sections(body, REMOVED_SECTION):
        removals = find_removals(files, pr_ref)
        if removals:
            problems.append(removal_problem(removals))

    snapshots = changed_snapshots(files)
    if snapshots:
        snapshot_text = "\n".join(filled_sections(body, SNAPSHOT_SECTION))
        snapshots = [p for p in snapshots if os.path.basename(p) not in snapshot_text]
    if snapshots:
        problems.append(snapshot_problem(snapshots))

    if not problems:
        allow()

    deny(
        "Refusing `gh pr merge` on this PR.\n\n"
        + "\n\n".join(problems)
        + "\n\nRules and known false positives: .claude/hooks/check-removed-for-users.py."
    )


if __name__ == "__main__":
    main()
