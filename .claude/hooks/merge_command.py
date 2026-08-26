#!/usr/bin/env python3
"""
Shared matcher for the three merge-gate hooks: does this Bash command *run*
`gh pr merge`, as opposed to merely mentioning it?

A mention inside a commit message, a heredoc'd doc edit, or an echo used to
trip every gate (2026-08-26: two doc-edit commands were denied as hard-rail
merges). Heredoc bodies and quoted literals are stripped first, then the
phrase must sit at a command position (start of line, after `;`, `&&`, `|`,
`(`, `$(`, or an env-var prefix).

Known limitation: `bash -c "gh pr merge 1"` hides the merge inside a quoted
literal and is not matched. That is a policy violation, not a hook gap.
"""
import re

HEREDOC = re.compile(r"<<-?\s*(['\"]?)(\w+)\1[^\n]*\n.*?^\s*\2\s*$", re.S | re.M)
DOUBLE_QUOTED = re.compile(r'"(?:\\.|[^"\\])*"')
SINGLE_QUOTED = re.compile(r"'[^']*'")
COMMAND_POSITION = re.compile(
    r"(?:^|[;&|(\n]|\$\()\s*(?:\w+=\S*\s+)*gh\s+pr\s+merge\b"
)


def strip_literals(cmd):
    without_heredocs = HEREDOC.sub("", cmd)
    without_double = DOUBLE_QUOTED.sub('""', without_heredocs)
    return SINGLE_QUOTED.sub("''", without_double)


def is_gh_pr_merge(cmd):
    return bool(COMMAND_POSITION.search(strip_literals(cmd)))
