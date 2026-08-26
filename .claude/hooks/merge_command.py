#!/usr/bin/env python3
"""
Shared matcher for the three merge-gate hooks: does this Bash command *run*
`gh pr merge`, as opposed to merely mentioning it?

A mention inside a commit message, a heredoc'd doc edit, or an echo used to
trip every gate (2026-08-26: two doc-edit commands were denied as hard-rail
merges). Heredoc bodies and quoted literals are stripped first; whatever is
left is real shell, so any remaining occurrence counts — `then gh pr merge`,
`exec gh pr merge`, and backtick substitution all match (a command-position
anchor missed those, per the PR #4244 security review).

The REST merge endpoint (`gh api -X PUT repos/o/r/pulls/N/merge`, or curl to
the same URL) counts too — it was used once, on 2026-08-26, to merge #4244 on
Alexander's instruction after the hook (correctly) refused the rail PR, and that
is exactly the path an agent must not have.

Known limitation: `bash -c "gh pr merge 1"` hides the merge inside a quoted
literal and is not matched. That is a policy violation, not a hook gap.
"""
import re

HEREDOC = re.compile(r"<<-?\s*(['\"]?)(\w+)\1[^\n]*\n.*?^\s*\2\s*$", re.S | re.M)
QUOTED_LITERAL = re.compile(r"'[^']*'|\"(?:\\.|[^\"\\])*\"")
GH_PR_MERGE = re.compile(r"\bgh\s+pr\s+merge\b")
API_MERGE = re.compile(r"\bpulls/(\d+)/merge\b")
PR_URL = re.compile(r"https?://github\.com/[^/]+/[^/]+/pull/(\d+)")


def strip_literals(cmd):
    without_heredocs = HEREDOC.sub("", cmd)
    return QUOTED_LITERAL.sub("", without_heredocs)


def is_gh_pr_merge(cmd):
    stripped = strip_literals(cmd)
    return bool(GH_PR_MERGE.search(stripped) or API_MERGE.search(cmd))


def extract_pr_ref(cmd):
    """PR number the command merges, or None when `gh pr merge` targets the current branch."""
    api_match = API_MERGE.search(cmd)
    if api_match:
        return api_match.group(1)
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
