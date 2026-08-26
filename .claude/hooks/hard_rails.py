#!/usr/bin/env python3
"""
Hard-rail path list: the surfaces an agent may never merge on its own.

`check-merge-status.py` denies `gh pr merge` when a PR touches any of these;
the PR waits for Alexander in the GitHub UI instead. The harness itself
(`.claude/`, `CLAUDE.md`, `.github/`) is a rail so an agent cannot rewrite its
own gate or brief and self-merge. Widening or narrowing this list is its own
PR — never folded into feature work.
See `.claude/docs/autonomous-shipping.md`.
"""

NAME_GLOBS = (
    "auth",
    "stripe",
    "subscription",
    "checkout",
    "webhook",
    "password",
    "login",
    "oauth",
    "session",
    "jwt",
    "pricing",
    "signup",
    "checkmonthly",
    "passes",
)

EXPLICIT_PREFIXES = (
    "migrations/",
    "src/data_layer/public/",
    ".github/",
    "scripts/deploy-",
    ".claude/",
    "src/services/EmailService/templates/subscription-",
    "src/services/EmailService/templates/abandoned-checkout-",
)

EXPLICIT_FILES = (
    "ecosystem.blue-green.config.js",
    "CLAUDE.md",
    "src/server.ts",
    "src/lib/isPaying.ts",
    "src/lib/ankify/access.ts",
)

CONTENT_TRIGGERS = (
    "AUTO_SYNC_PRODUCT_ID",
    "max_memory_restart",
    "max-old-space-size",
    "process.env.SECRET",
    "SUBSCRIBER_MAP_LIMIT",
    "SUBSCRIBER_NODE_LIMIT",
)


def is_rail_path(path):
    lowered = path.lower()
    if any(glob in lowered for glob in NAME_GLOBS):
        return True
    if path in EXPLICIT_FILES:
        return True
    return any(path.startswith(prefix) for prefix in EXPLICIT_PREFIXES)


def rail_paths(paths):
    return [p for p in paths if is_rail_path(p)]


def rail_content_hits(diff_text):
    changed_lines = [
        line[1:]
        for line in diff_text.splitlines()
        if (line.startswith("+") or line.startswith("-"))
        and not line.startswith("+++")
        and not line.startswith("---")
    ]
    hits = []
    for trigger in CONTENT_TRIGGERS:
        if any(trigger in line for line in changed_lines):
            hits.append(trigger)
    return hits
