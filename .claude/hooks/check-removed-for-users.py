#!/usr/bin/env python3
"""
PreToolUse -> Bash: block `gh pr merge` when a PR removes something users see,
or changes a golden snapshot, without the PR body saying so.

Why: #4589 removed the held-back-cards notice for signed-in free users as a
side effect of an anonymous-visitor feature, and its body said the other paths
were unchanged. Purchases after that notice fell from about 9% to 1.5% for 19
days until #4789 restored it. Golden snapshots can be regenerated with `-u` and
merged with nobody explaining the diff.

Rule 1, removed for users. Any of these needs a non-empty `## Removed for users`
section in the PR body:
  - A key/value line removed from an English locale file
    (`web/src/lib/i18n/locales/en/*.json`; en is the source of truth, so the
    other nine locales are not read). Not counted: the same key re-added in the
    same file (a copy edit), or the same value added in any en file (a rename
    or a move between namespaces).
  - A deleted `web/src/**/*.tsx` component (tests and stories excluded) whose
    name contains Notice, Warning, Banner, Alert, Callout or Toast as a
    PascalCase word (`FooNotice/index.tsx` counts by its folder name). Not
    counted: a rename, or a file with the same component name added elsewhere.
  - A removed `const` in non-test `src/**/*.ts` whose UPPER_SNAKE name has a
    WARNING or NOTICE word (`AI_CREDITS_EXHAUSTED_WARNING_CODE`): the codes and
    texts the server sends with a conversion. Not counted: the same name
    declared on an added line anywhere in the diff.
Rule 2, snapshot changes. A modified, deleted or renamed file under a `golden/`
directory that is not a .ts/.tsx/.js source (the `__snapshots__/*.snap` files,
golden fixtures) needs a `## Snapshot changes` section that names each changed
file by its basename.

A section is empty when it holds only whitespace, HTML comments, or a bare
placeholder ("None.", "N/A", "TBD"). "None, the strings moved to X" passes:
that is the out for a false positive, and it puts the reason on the record.

Known false positives: a key removed and re-added with a different value in a
different en file; a deleted component whose name merely contains Alert (an
AlertDialog shell); a WARNING constant that never reaches a user (an email job
interval). Known false negatives: a notice rendered inline in a component that
survives (the JSX goes, the file stays), user-facing English literals outside
the locale files, a server warning built from a string literal with no named
constant, and anything in a diff GitHub refuses to serve (too large), where the
string and constant checks fail open while the file-list checks still run.

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

LOCALE_ENTRY = re.compile(r'^\s*"((?:[^"\\]|\\.)+)"\s*:\s*"((?:[^"\\]|\\.)*)"\s*,?\s*$')
NOTICE_WORD = re.compile(r"(Notice|Warning|Banner|Alert|Callout|Toast)(?![a-z])")
CONST_DECL = re.compile(r"^\s*(?:export\s+)?const\s+([A-Z][A-Z0-9_]*)\b")
WARNING_WORDS = {"WARNING", "WARNINGS", "NOTICE", "NOTICES"}
SOURCE_EXTENSIONS = (".ts", ".tsx", ".js", ".mjs", ".cjs")
PLACEHOLDERS = {"", "none", "na", "nothing", "tbd", "todo"}
HTML_COMMENT = re.compile(r"<!--.*?-->", re.S)


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
        result = subprocess.run(args, capture_output=True, text=True, timeout=30)
    except (subprocess.TimeoutExpired, FileNotFoundError) as exc:
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
        return json.loads(stdout)
    except json.JSONDecodeError:
        sys.stderr.write(f"{TAG} could not parse gh JSON; allowing merge.\n")
        return None


def fetch_diff(pr_ref):
    return run_gh(gh_args("diff", pr_ref, ["--color", "never"]), "the string and constant checks")


def is_en_locale(path):
    return path.startswith(EN_LOCALE_PREFIX) and path.endswith(".json")


def is_server_source(path):
    if not (path.startswith("src/") and path.endswith(".ts")):
        return False
    if path.endswith(".d.ts") or ".test." in path:
        return False
    return not (
        path.startswith("src/data_layer/public/")
        or path.startswith("src/test/")
        or "/fixtures/" in path
    )


def is_web_component(path):
    if not (path.startswith("web/src/") and path.endswith(".tsx")):
        return False
    return ".test." not in path and ".stories." not in path


def component_name(path):
    parts = path.split("/")
    stem = parts[-1].rsplit(".", 1)[0]
    if stem == "index" and len(parts) > 1:
        return parts[-2]
    return stem


def is_golden_snapshot(path):
    segments = path.split("/")
    if "golden" not in segments[:-1]:
        return False
    return not path.endswith(SOURCE_EXTENSIONS)


def parse_diff(diff_text):
    removed, added = [], []
    current_old, current_new, in_hunk = None, None, False
    for line in diff_text.splitlines():
        if line.startswith("diff --git "):
            match = re.match(r"diff --git a/(.+?) b/(.+)$", line)
            current_old, current_new = (match.group(1), match.group(2)) if match else (None, None)
            in_hunk = False
        elif line.startswith("@@"):
            in_hunk = True
        elif in_hunk and line.startswith("-"):
            removed.append((current_old, line[1:]))
        elif in_hunk and line.startswith("+"):
            added.append((current_new, line[1:]))
    return removed, added


def removed_locale_strings(removed, added):
    added_entries = [
        (path, LOCALE_ENTRY.match(text)) for path, text in added if path and is_en_locale(path)
    ]
    added_keys = {(path, m.group(1)) for path, m in added_entries if m}
    added_values = {m.group(2) for _, m in added_entries if m}
    findings = []
    for path, text in removed:
        if not (path and is_en_locale(path)):
            continue
        match = LOCALE_ENTRY.match(text)
        if not match:
            continue
        key, value = match.group(1), match.group(2)
        if (path, key) in added_keys or value in added_values:
            continue
        preview = value if len(value) <= 60 else value[:57] + "..."
        findings.append(f'{os.path.basename(path)}: {key} ("{preview}")')
    return findings


def declared_warning_constants(lines):
    names = []
    for path, text in lines:
        if not (path and is_server_source(path)):
            continue
        match = CONST_DECL.match(text)
        if match and WARNING_WORDS & set(match.group(1).split("_")):
            names.append((path, match.group(1)))
    return names


def removed_server_warnings(removed, added):
    re_declared = {name for _, name in declared_warning_constants(added)}
    return [
        f"{path}: {name}"
        for path, name in declared_warning_constants(removed)
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
        if f.get("changeType") != "ADDED" and is_golden_snapshot(f.get("path", ""))
    ]


def needs_diff(files):
    for entry in files:
        path = entry.get("path", "")
        if entry.get("changeType") == "ADDED" or entry.get("deletions") == 0:
            continue
        if is_en_locale(path) or is_server_source(path):
            return True
    return False


def section_text(body, heading):
    pattern = re.compile(
        rf"^#{{2}}\s+{re.escape(heading)}\s*$\n?(.*?)(?=^#{{1,2}}\s|\Z)",
        re.M | re.S | re.I,
    )
    match = pattern.search(body or "")
    if not match:
        return None
    return HTML_COMMENT.sub("", match.group(1)).strip()


def is_filled(text):
    if text is None:
        return False
    return re.sub(r"[^a-z]", "", text.lower()) not in PLACEHOLDERS


def listed(items):
    shown = [f"  {item}" for item in items[:MAX_LISTED]]
    if len(items) > MAX_LISTED:
        shown.append(f"  ...and {len(items) - MAX_LISTED} more")
    return "\n".join(shown)


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

    if pr_data.get("author", {}).get("login", "") == "dependabot[bot]":
        allow()

    files = pr_data.get("files") or []
    body = pr_data.get("body") or ""

    removals = removed_notice_components(files)
    if needs_diff(files):
        diff_text = fetch_diff(pr_ref)
        if diff_text is not None:
            removed, added = parse_diff(diff_text)
            removals = removed_locale_strings(removed, added) + removals
            removals += removed_server_warnings(removed, added)

    problems = []
    if removals and not is_filled(section_text(body, REMOVED_SECTION)):
        problems.append(
            f"It removes things users see, and the body has no filled `## {REMOVED_SECTION}` "
            "section:\n" + listed(removals) + "\n\n"
            f"  Add `## {REMOVED_SECTION}` saying who loses what, on which path. If nothing\n"
            "  is lost (a moved string, a renamed notice), write \"None, <why>\"."
        )

    snapshots = changed_snapshots(files)
    snapshot_text = section_text(body, SNAPSHOT_SECTION)
    if snapshots and is_filled(snapshot_text):
        snapshots = [p for p in snapshots if os.path.basename(p) not in snapshot_text]
    if snapshots:
        problems.append(
            f"It changes golden snapshots the `## {SNAPSHOT_SECTION}` section does not "
            "explain:\n" + listed(snapshots) + "\n\n"
            f"  Add `## {SNAPSHOT_SECTION}` with one line per file, naming it by basename,\n"
            "  saying what the output now does differently and why that is right."
        )

    if not problems:
        allow()

    deny(
        "Refusing `gh pr merge` on this PR.\n\n"
        + "\n\n".join(problems)
        + "\n\nWhy: #4589 dropped a notice for signed-in free users while its body said "
        "nothing else changed; purchases after it fell for 19 days. "
        "Rules and known false positives: .claude/hooks/check-removed-for-users.py."
    )


if __name__ == "__main__":
    main()
