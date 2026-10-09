#!/usr/bin/env python3
"""
PreToolUse -> Bash: validate staged `Documentation/specs/*.md` on `git commit`.

The pm spec format (`.claude/agents/pm.md` section 4) lived in prose with no
computational sensor; a spec could ship missing whole sections and nothing
noticed. This hook is that sensor (OpenSpec `validate`, issue #4427 item 3).

On any `git commit` that stages a spec file it asserts:
  1. Every required pm-format heading is present (see REQUIRED_HEADINGS).
  2. On an implementation-phase commit, zero `[NEEDS CLARIFICATION]` markers
     remain — ambiguities must be resolved into the spec before code lands
     (issue #4427 item 2). A `docs:`-prefixed commit is the drafting/clarify
     phase, so markers are tolerated there; any other prefix is implementation.

The required-heading list is derived from pm.md's actual format, not the issue's
hand-copied subset — pm.md is the source of truth (#4427 said to follow it).

Deletions are not checked (the `chore: remove implemented spec` commit `git rm`s
the file). A commit that stages no spec file is unaffected. Any git tooling
error fails open. Bypass a one-off with CLAUDE_SKIP_SPEC_CHECK=1 git commit ...
"""
import json
import os
import re
import subprocess
import sys


REQUIRED_HEADINGS = [
    "Outcome",
    "Goal alignment",
    "Problem",
    "Riskiest assumption",
    "Smallest test",
    "What this removes",
    "Primary action",
    "Default behavior",
    "Surface vocabulary",
    "Scope",
    "User story",
    "Acceptance criteria",
    "Open questions",
    "Out of scope",
]

CLARIFICATION_MARKER = re.compile(r"\[NEEDS CLARIFICATION")
DOCS_PREFIX = re.compile(r"^docs(\([^)]*\))?!?:", re.IGNORECASE)
SPEC_PATH = re.compile(r"^Documentation/specs/.+\.md$")

HEREDOC = re.compile(r"<<-?\s*['\"]?(\w+)['\"]?\s*\n.*?\n\s*\1\b", re.DOTALL)
QUOTED_LITERAL = re.compile(r"'[^']*'|\"(?:\\.|[^\"\\])*\"")
GIT_COMMIT = re.compile(r"\bgit\s+commit\b")
DASH_M_QUOTED = re.compile(r"-m\s+(['\"])(.*?)\1", re.DOTALL)
LONG_FLAG = re.compile(r"--message=(['\"])(.*?)\1", re.DOTALL)


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


def heading_present(text, label):
    esc = re.escape(label)
    bold = r"\*\*\s*" + esc + r"\b[^*\n]*\*\*"
    heading = r"^\s{0,3}#{1,6}\s+" + esc + r"\b"
    if re.search(bold, text, re.IGNORECASE):
        return True
    return re.search(heading, text, re.IGNORECASE | re.MULTILINE) is not None


def missing_headings(text):
    return [label for label in REQUIRED_HEADINGS if not heading_present(text, label)]


def clarification_marker_count(text):
    return len(CLARIFICATION_MARKER.findall(text))


def is_git_commit(command):
    shell = QUOTED_LITERAL.sub("", HEREDOC.sub("", command))
    if GIT_COMMIT.search(shell) is None:
        return False
    return not any(
        flag in shell for flag in ("--amend", "--no-edit", "--squash", "--fixup")
    )


def extract_commit_message(command):
    dash_m = DASH_M_QUOTED.findall(command)
    if dash_m:
        return "\n\n".join(value for _quote, value in dash_m)
    eq = LONG_FLAG.search(command)
    if eq:
        return eq.group(2)
    return None


def markers_allowed(command):
    message = extract_commit_message(command)
    if message is None:
        return True
    subject = message.strip().splitlines()[0].strip() if message.strip() else ""
    return bool(DOCS_PREFIX.match(subject))


def git_output(args):
    try:
        result = subprocess.run(
            ["git", *args], capture_output=True, text=True, timeout=10
        )
    except (subprocess.TimeoutExpired, FileNotFoundError) as exc:
        sys.stderr.write(f"[check-spec-format] git {args[0]} failed ({exc}); allowing.\n")
        return None
    if result.returncode != 0:
        sys.stderr.write(
            f"[check-spec-format] git {args[0]} exited {result.returncode}; allowing.\n"
        )
        return None
    return result.stdout


def repo_root():
    out = git_output(["rev-parse", "--show-toplevel"])
    return out.strip() if out else None


def staged_spec_files(root):
    out = git_output(
        ["-C", root, "diff", "--cached", "--name-only", "--diff-filter=ACM"]
    )
    if out is None:
        return None
    return [line for line in out.splitlines() if SPEC_PATH.match(line.strip())]


def read_staged_spec(root, path):
    return git_output(["-C", root, "show", f":{path}"])


def build_violations(command, specs):
    allow_markers = markers_allowed(command)
    violations = []
    for path, text in specs:
        if text is None:
            continue
        missing = missing_headings(text)
        if missing:
            violations.append(
                f"{path}: missing required heading(s): {', '.join(missing)}"
            )
        if not allow_markers:
            count = clarification_marker_count(text)
            if count:
                violations.append(
                    f"{path}: {count} `[NEEDS CLARIFICATION]` marker(s) remain — "
                    "resolve them into the spec before an implementation commit "
                    "(a `docs:` commit may keep them; this commit may not)"
                )
    return violations


def main():
    if os.environ.get("CLAUDE_SKIP_SPEC_CHECK"):
        allow()

    try:
        data = json.loads(sys.stdin.read())
    except json.JSONDecodeError:
        allow()

    if data.get("tool_name") != "Bash":
        allow()

    command = data.get("tool_input", {}).get("command", "")
    if not is_git_commit(command):
        allow()

    root = repo_root()
    if root is None:
        allow()

    paths = staged_spec_files(root)
    if not paths:
        allow()

    specs = [(path, read_staged_spec(root, path)) for path in paths]
    violations = build_violations(command, specs)

    if violations:
        bullet_list = "\n".join(f"  - {v}" for v in violations)
        deny(
            "Refusing `git commit` — a staged spec is not valid against the pm "
            "format (.claude/agents/pm.md section 4):\n"
            f"{bullet_list}\n\n"
            "Every spec needs these headings: "
            f"{', '.join(REQUIRED_HEADINGS)}.\n"
            "Add the missing sections (or resolve the markers) and retry.\n"
            "Bypass a one-off with CLAUDE_SKIP_SPEC_CHECK=1 in the command env."
        )

    allow()


if __name__ == "__main__":
    main()
