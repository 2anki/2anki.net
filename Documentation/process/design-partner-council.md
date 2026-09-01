# Design-partner council

A standing cohort of 5-10 long-tenure power users who see new surfaces before GA
and reply with what is wrong while it still costs nothing to change. Lightweight
by design: an invite email and an inbox label, not a portal.

## Why this exists

Power users have shaped the roadmap for free for years (the 2024 PDF/AI feature
came from one persistent user). This writes that down so it is deliberate and
capped, and forecloses heavier builds (portal, forum, council page) that add
maintenance without adding signal.

## Selection criteria

- Account age >= 24 months.
- Active: >= 1 upload or sync in the last 90 days.
- Signal history: >= 2 substantive support messages, or a shipped idea.
- Use-case spread across med, law, language, general.
- Reachable and has replied before.
- Hard cap 5-10.

The roster is selected by querying production. No names or emails in this repo.

## The offer

- `ankify_access` comped for the duration of membership.
- Sight of each new surface before GA.
- A direct feedback line. The only commitment is replying with what breaks.

## Comp mechanism

`UPDATE users SET ankify_access = true WHERE id = <id>`. Revoke by flipping to
false. Never `patreon = true`, never a synthetic `subscriptions` row. A no-op
for lifetime members, whose offer is early access alone.

## Membership tracking

A `council` label on the support inbox. No DB flag, no table, no migration.

## Feedback flow

Members email support -> triage applies `council` -> the normal triage-feedback
and issue-filing flow. No new channel.

## Invite copy

Hand-sent plaintext per the support-email workflow (the sent file lives in
Downloads, never in this repo). Template - follows the support-email rules (no
dashes, no gender inference, first-name salutation):

    Subject: Early access to what we build next

    Hi <first name>,

    You have been using 2anki for a long time, and your reports have shaped
    what we build. I want to make that direct.

    I am inviting a small group of long time users to see new features before
    they ship and tell me what is wrong with them while it still costs nothing
    to change. Five to ten people. No meetings, no portal. Just early access
    and a direct line to me.

    The offer:
    - Full access to Auto Sync, Mindmaps, and every paid feature, comped for
      as long as you are in the group.
    - You see each new surface before it reaches everyone else.
    - You reply to this thread with what breaks or what is missing. That is
      the whole commitment.

    If you want in, reply to this email. I will turn on your access the same
    day.

    Thanks for sticking with 2anki.

    Alexander

## Scope guard

The council reviews the one surface already in flight, in its pre-GA window. It
does not authorize parallel surfaces or reopen unmeasured parallel bets.

## Cadence and kill condition

Reviewed at T+30 and every release after. Metric: council-sourced findings that
ship, per release cycle, read from the `council` inbox label plus PR and issue
cross-links, against the pre-council organic baseline of the prior two cycles.
If it does not beat that baseline within two cycles, disband and revoke grants.
Silence is removal.
