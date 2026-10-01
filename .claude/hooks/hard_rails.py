#!/usr/bin/env python3
"""
Hard-rail path list: the surfaces an agent may never merge on its own.

`check-merge-status.py` denies `gh pr merge` when a PR touches any of these;
the PR waits for Alexander in the GitHub UI instead. The harness itself
(`.claude/`, `CLAUDE.md`, `.github/`) is a rail so an agent cannot rewrite its
own gate or brief and self-merge. Widening or narrowing this list is its own
PR — never folded into feature work.

Three kinds of trigger, and they are not interchangeable. A name glob catches a
surface by what it is called. An explicit path catches a known file. A content
trigger catches a *value* wherever it lives, which is the only one that still
works after the constant moves to a new file — prefer it for production limits.
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
    # Files whose entire job is to hold a production limit, listed as well as
    # content-triggered so a rename or a refactor that drops the constant name
    # still lands on the rail.
    "src/lib/httpServerTimeouts.ts",
    "src/lib/misc/getUploadLimits.ts",
    "src/lib/claude/aiSpendGuard.ts",
)

# A production safety limit is a rail wherever it lives. CLAUDE.md states the
# two strongest "never" rules in the repo over these values - never lower a
# safety limit on an inference, and never swap a model on a paid path without a
# cost-envelope check - and until now neither had a sensor: PR #4632 changed
# Node's request timeout from 300s to 900s on every route and `rail_paths` plus
# `rail_content_hits` both came back empty. Triggering on the constant name
# rather than the file keeps the rail attached to the value when it moves.
#
# These are low-churn by nature: over the six months to 2026-10-01 each of them
# appears in one to eight commits, so the rail costs roughly one flagged PR a
# week. Churn is the test to re-run before adding a name here - a trigger that
# fires on ordinary feature work gets resented and then ignored.
CONTENT_TRIGGERS = (
    "AUTO_SYNC_PRODUCT_ID",
    "max_memory_restart",
    "max-old-space-size",
    "process.env.SECRET",
    "SUBSCRIBER_MAP_LIMIT",
    "SUBSCRIBER_NODE_LIMIT",
    # Node's own request/connection ceilings. Raising these holds sockets and
    # heap for longer on every route, not just the one being fixed.
    "REQUEST_TIMEOUT_MS",
    "HEADERS_TIMEOUT_MS",
    "KEEP_ALIVE_TIMEOUT_MS",
    "requestTimeout",
    "headersTimeout",
    "keepAliveTimeout",
    "UPLOAD_PROXY_TIMEOUT_SECONDS",
    # Paid-inference budgets. CLAUDE.md: "Re-read every budget tuned to the old
    # model (max_tokens ceilings, chunk sizes, retry loops that re-bill on
    # truncation) before merge."
    "CHUNK_MAX_TOKENS",
    "GIANT_INPUT_CHUNK_SIZE",
    "VISION_MAX_TOKENS",
    "VISION_RETRY_MAX_TOKENS",
    "PDF_PAGE_VISION_MAX_TOKENS",
    "PDF_PAGE_VISION_RETRY_MAX_TOKENS",
    "AI_SPEND_ALERT_THRESHOLD_USD",
    "VISION_TOKEN_CEILING_OVERRIDE",
    "RESERVED_CREDITS_PER_INFLIGHT_CALL",
    # What a free account is allowed. Moving these moves revenue.
    "MONTHLY_CARD_LIMIT",
    "ANONYMOUS_CARD_CAP",
    "FREE_PHOTO_QUOTA_PER_MONTH",
    "FREE_USER_MAX_UPLOAD_SIZE",
    "PAYING_MAX_UPLOAD_SIZE",
)


# A changelog entry is prose about a shipped change, not the change. 67 of the
# 906 entries carry a word from NAME_GLOBS in their slug - "pricing",
# "checkout", "signup" - so without this one in fourteen user-visible PRs became
# a manual merge because of how its entry was worded. A rail that fires on
# wording teaches agents to read rail denials as noise.
CHANGELOG_DIR = "web/src/pages/WhatsNewPage/changelog/"


def is_rail_path(path):
    if path.startswith(CHANGELOG_DIR):
        return False
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
