---
description: Work GitHub issues that drive acquisition — verify relevance, close stale ones, fan out at most two engineer agents to open review-ready PRs
argument-hint: optional — issue numbers to prioritize, or an acquisition sub-area (landing, signup, onboarding)
---

Work through 2anki/server GitHub issues to drive ACQUISITION — getting a
first-time visitor to a finished deck, signed up, and converted. That is the
binding constraint from the latest weekly retro (new paid conversions collapsed
from ~28/wk to ~3/wk; signups ~7.6/day). Everything you touch must plausibly
reduce friction somewhere on: landing page → first upload → preview → download →
signup → paid. Work autonomously; do not wait on me between issues.

If arguments were given ($ARGUMENTS), treat them as the seed: specific issue
numbers to prioritize, or an acquisition sub-area to focus on. Otherwise triage
the whole open-issue list through the acquisition filter below.

ACQUISITION FILTER — only pick issues that move the top of the funnel:
  IN SCOPE: landing/SEO pages, the convert path for logged-out/new users,
  upload → preview → download friction, signup/registration flow, onboarding,
  first-deck activation, the /limit and paywall screens, shareability, broken
  conversions that make a first-timer bounce.
  OUT OF SCOPE: power-user/settings features for existing paid users, internal
  refactors, deep Notion edge cases that only long-tail users hit. If an issue
  doesn't credibly affect a NEW user's path to a deck, skip it — leave it open.

STEP 0 — VERIFY RELEVANCE before any code. For each candidate issue:
  - Reproduce against current origin/main (pull first). An issue is NOT RELEVANT
    if (a) already fixed — write a failing test and it passes; (b) the surface
    no longer exists; (c) it's a duplicate of another open/closed issue; (d) it's
    spam/junk.
  - If NOT RELEVANT: close it with a short, specific, VOICE.md-compliant comment
    stating the concrete evidence ("This was fixed in <area>; converting X now
    produces Y" / "duplicate of #N" / "the <surface> referenced here was removed").
    Use `gh issue comment` then `gh issue close`. NEVER close on a hunch — only
    with reproduced evidence. NEVER name the reporter or quote their content.
  - If RELEVANT and in acquisition scope: queue it for a fix.

FAN OUT — at most TWO engineer agents running concurrently (never more). Each
agent works in its own git worktree (isolation: "worktree"), on ONE issue, off a
FRESH origin/main (never stack branches). When one finishes, start the next from
the queue. Brief each agent to `pwd`-verify its worktree and HALT rather than
commit into the main checkout.

PER-ISSUE WORKFLOW (each agent):
  1. git checkout main && pull; branch fix/<slug> or feat/<slug>.
  2. TDD: failing test that reproduces the issue → confirm it fails for the right
     reason → smallest fix → green.
  3. Changelog JSON entry only if a real user would notice (web/src/pages/
     WhatsNewPage/changelog/), per the rules; otherwise state "no entry" in the PR.
  4. Run /check. Run sonar-scanner if a token is configured; if not, say so in
     the PR body.
  5. If the diff touches web/src/, add the ## Browser check attestation.
  6. Conventional commit, subject ≤72 chars, "Fixes #<n>", Co-Authored-By line.
  7. git push -u origin <branch>; open the PR READY (not draft); then run /ship <n>.

ABSOLUTE SAFETY RULES (non-negotiable):
  - Merge ONLY through /ship. NEVER run `gh pr merge` by hand, NEVER set
    CLAUDE_SKIP_SAFETY. A hard-rail PR stays ready for my review.
  - NEVER push to main. NEVER `git push` without `-u origin <branch>`.
  - Deploys happen only through /ship (CI). NEVER SSH to prod outside the
    read-only /deploy-status inside /ship. NEVER touch production data.
  - One PR per issue, off fresh origin/main. Never stack branches.
  - NEVER put a reporter's name, email, Notion workspace, or deck title in a
    commit, PR, branch, or issue comment — use the numeric user ID or a role.
  - When blocked or unsure an issue is safe/in-scope, SKIP it and leave it open.
    Prefer doing nothing over shipping something wrong.

LOG one line per issue as you go: issue # → verified relevant / closed (reason) /
fixed (PR #) / skipped (reason). Stop when the acquisition-relevant queue is
empty, you hit a tool/rate limit, or two agents can't make safe progress.

Start now: pull main, pull the open issues, triage by the acquisition filter,
and begin.
