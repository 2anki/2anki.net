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

Known limitation: `bash -c "gh pr merge 1"` hides the merge inside a quoted
literal and is not matched. That is a policy violation, not a hook gap.
"""
import re

HEREDOC = re.compile(r"<<-?\s*(['\"]?)(\w+)\1[^\n]*\n.*?^\s*\2\s*$", re.S | re.M)
QUOTED_LITERAL = re.compile(r"'[^']*'|\"(?:\\.|[^\"\\])*\"")
GH_PR_MERGE = re.compile(r"\bgh\s+pr\s+merge\b")


def strip_literals(cmd):
    without_heredocs = HEREDOC.sub("", cmd)
    return QUOTED_LITERAL.sub("", without_heredocs)


def is_gh_pr_merge(cmd):
    return bool(GH_PR_MERGE.search(strip_literals(cmd)))
