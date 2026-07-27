---
description: Weekly retro - pull metrics, compare to goal trajectory, recommend one priority shift
argument-hint: paste this week's numbers, or leave empty to ask for them
---

Use the `pm` agent.

## 1. Pull DB-backed metrics (top of retro)

Pull these **before** any GA4 work — they're the load-bearing numbers, GA4 is the qualifier:

- **Total registered users** (vs the 300K goal in `CLAUDE.md`)
- **Signups this week** (`users.created_at >= now() - interval '7 days'`) and the prior week for WoW
- **Active paying subs**, **new paid subs this week**, **pass sales this week**, **30d paid churn % (approximation)**
- **Top cancellation reasons (last 14d)** — replaces the manual "top 3 support themes" ask

**Do not measure MRR or ARPU** — dropped from the retro by decision 2026-07-19. Revenue movement is read as paying subs × new-paid/wk × pass sales; when a dollar figure is needed, Alexander reads the Stripe dashboard directly.

**Fetch via read-only psql on prod over SSH — no cookies, no asking the user to paste anything:**

```bash
ssh alemayhu@2anki.net 'DBURL=$(grep "^DATABASE_URL=" /home/alemayhu/src/github.com/2anki/2anki.net/.env | cut -d= -f2-); psql "$DBURL" -At <<SQL ... SQL'
```

Queries (all read-only):

- Registered: `SELECT count(*) FROM users`
- Signups: `count(*) FROM users WHERE created_at >= now() - interval '7 days'` (and the 7–14 day window for WoW)
- Active subs: `count(*) FROM subscriptions WHERE active = true`
- New paid subs 7d: `count(*) FROM subscriptions WHERE active = true AND to_timestamp((payload->>'created')::bigint) >= now() - interval '7 days'`
- Pass sales 7d: `SELECT props->>'plan', count(*) FROM events WHERE name = 'checkout_completed' AND created_at >= now() - interval '7 days' GROUP BY 1` (`24h`/`7d` = passes, `subscription` = subs)
- Churn 30d approx: subs with `payload->>'canceled_at'` in the last 30 days ÷ active subs. This is a DB approximation of the Stripe-derived number — label it as such.
- Cancellation reasons: `SELECT reason, count(*) FROM cancellation_feedback WHERE created_at >= now() - interval '14 days' GROUP BY 1 ORDER BY 2 DESC`

**If a query fails**, do not silently skip — record the missing field under "Gaps to close before next retro" in the output.

### 1a. Pull the v2 funnel read (per signup_origin)

This is the "stop flying blind" read — the leak between landing → upload → download → checkout → paid, per acquisition source. Pull it every retro; it answers whether the v2 targets (page→checkout ≥10%, checkout→paid ≥50%) are being hit and which origin leaks.

Pull it with the same SSH+psql channel as section 1 (the ops endpoints are cookie-gated; the DB query is the same data):

```sql
SELECT COALESCE(props->>'signup_origin','(none)') AS origin, name AS stage,
       count(distinct COALESCE(user_id::text, anonymous_id)) AS n
FROM events
WHERE name IN ('upload_started','deck_downloaded','account_created','checkout_completed')
  AND created_at >= now() - interval '7 days'
GROUP BY 1, 2 ORDER BY 1, 2;
```

Report one table: per origin, `upload_started → deck_downloaded → account_created → checkout_completed` plus upload→download and download→paid rates. Name the single biggest leak stage and the origin it hits hardest. Known gap (as of 2026-07-19): `signup_origin` is missing on `upload_started`/`checkout_completed` events, so the per-origin read is mostly `(none)` until that instrumentation fix lands — keep flagging it in the gaps section while true. If the read fails, record it under "Gaps to close before next retro" — do not skip silently.

### 1b. Pull AI usage and cost concentration

AI is the only per-use variable cost in the product — every other cost is flat. This read answers "how many people are actually using it, and how concentrated is the spend," so a rising Anthropic bill can be read as growth or as one heavy user before it becomes a decision. Same SSH+psql channel as section 1.

```sql
-- distinct users per AI surface, last 7 days
SELECT 'ai_conversions' surface, count(*) uses, count(DISTINCT user_id) users
  FROM events WHERE name='ai_conversion_completed' AND created_at >= now() - interval '7 days'
UNION ALL SELECT 'photo_to_deck', count(*), count(DISTINCT user_id)
  FROM events WHERE name='vision_photo_converted' AND created_at >= now() - interval '7 days'
UNION ALL SELECT 'chat', count(*), count(DISTINCT c.user_id)
  FROM chat_messages m JOIN conversations c ON c.id=m.conversation_id
  WHERE m.created_at >= now() - interval '7 days'
UNION ALL SELECT 'mindmaps', count(*), count(DISTINCT user_id)
  FROM mindmaps WHERE created_at >= now() - interval '7 days'
UNION ALL SELECT 'mcp_active_tokens', count(*), count(DISTINCT user_id)
  FROM mcp_access_tokens WHERE expires_at > now();

-- concentration: top AI users and their share
SELECT user_id, count(*) conversions
  FROM events WHERE name='ai_conversion_completed' AND created_at >= now() - interval '7 days'
  GROUP BY 1 ORDER BY 2 DESC LIMIT 5;

-- funnel above AI: badge seen → toggled on → converted
SELECT name, count(DISTINCT user_id) users FROM events
  WHERE name IN ('upload_ai_badge_viewed','upload_ai_turned_on','ai_conversion_completed')
  AND created_at >= now() - interval '7 days' GROUP BY 1;
```

Report one table (surface / uses / distinct users) plus three derived numbers:

- **Distinct AI users this week** as a share of active paying subs — the adoption read.
- **Top-user share**: what fraction of AI conversions came from the single heaviest user. **Flag when one user exceeds 40%** — the bill is then one person's habits, not product growth, and a usage change by that one account will look like a trend.
- **Cost per AI conversion** = Anthropic month-to-date cost ÷ month-to-date `ai_conversion_completed` count. Compare against the $7.99 monthly price to name the break-even conversions/month; flag any top user above it.

The dollar figure is **not** in the DB — Alexander reads month-to-date total from the Anthropic console (Cost view, API key `2anki.net`). Ask for it once per retro; if it isn't supplied, report the usage table and concentration anyway and note the missing cost under "Gaps to close before next retro". Never guess or carry forward a stale dollar amount.

Baseline (2026-07-27, 27-day window): $77.52 MTD · 126 AI conversions by 10 users · 37 distinct users across all AI surfaces (~5% of paying subs) · top user 49% of conversions · ~$0.60/conversion · MCP 0 active tokens.

## 2. Pull GA4 traffic + engagement (last 7 days vs prior 7 days)

Use the `analytics-mcp` tools against GA4 property `properties/286902985`. Run these reports:

- Sessions + active users + new users by date (last 7 days vs prior 7 days).
- **Traffic Sources**: sessions, new users, and engagement rate by `sessionDefaultChannelGroup` + `sessionSource` — flag any channel that is up or down >20% week-over-week.
- Top events by event count.
- New vs returning users with avg session duration and engagement rate.

## 3. Bot/spam self-check (run before drawing conclusions)

The data can be distorted by a crawler surge faster than the GA4 admin UI can filter it. Run this check on the Traffic Sources output:

- If **Direct/(direct) sessions WoW > +50% AND Direct engagement rate dropped > 20%**, flag bot/referrer-spam traffic. State explicitly in the retro that headline session/new-user numbers are distorted and treat real-user metrics (engagement rate, returning-user behaviour, paid conversions) as the load-bearing signal for the week.
- If flagged: add "apply GA4 bot/referrer-spam filter" to the W+1 gaps list. The filter is a manual GA4 admin action — name it but don't try to fix it from the agent.

## 4. Compute

- Week-over-week change for each metric (sessions, new users, engagement rate, paid conversions, signups).
- Required weekly growth rate to reach the 300K-user goal in 24 / 18 / 12 months from the **DB user count** (not GA4 new users).
- Gap between actual and required.
- **Traffic Sources table**: which channels grew, which shrank, which drove engaged users vs bounce-and-leave.

## 5. Work-mix and treadmill check

Two standing checks on the week's merged PRs — both run every retro, both report a number:

- **Work-mix report.** Run the sensor: `npx tsx scripts/work-mix-report.ts` (needs `gh`). It classifies every PR merged in the last 7 days into acquisition (landing, SEO, onboarding, signup/first-conversion friction), monetization (pricing, paywall, retention, billing), core-quality (conversion correctness, performance, reliability of the existing pipeline), new-surface (a distinct new user-facing capability), or process (chore/ci/test/docs/deps); prints the count and share per bucket; and exits non-zero with a `FLAG:` line when **acquisition < 25%** — the bucket the `CLAUDE.md` allocation rule protects, and the only lane that creates users. The classifier is a heuristic decision-aid (`scripts/workMix.ts`) — sanity-check any PR it bucketed wrong before trusting the share, and state the flag in one line in the output.
- **Treadmill alarm.** Compare the chore+fix share of commits week-over-week against signups and new-paid. **Flag when chore+fix share rises while weekly signups and weekly new-paid are both flat or down** — that pattern is the 2023-25 stagnation signature (busy commit graph, zero acquisition work, no user growth for 36 months). Name it as such when it fires.

## 6. Write back the business-baseline block in `CLAUDE.md`

You already pulled paying subs, churn (approx), new-paid/wk, pass sales/wk, and registered users in section 1 — write them into the `### Business baseline` block in `CLAUDE.md` (update the date in the header and every number on the line). MRR and ARPU are not tracked there anymore — do not re-add them. This is the one place the baseline is allowed to change; every other agent reads it frozen. If a field couldn't be pulled this run, leave its prior value and note the staleness in "Gaps to close before next retro" — never blank it.

## 7. Identify the single biggest gap

Not three. One.

## 8. Tie it to the goal in `CLAUDE.md`

Does the gap come from making the product simpler/faster/more beautiful, or from scale? Be specific.

## 9. Recommend one priority shift for the next 7 days

Either:
- Spec X this week (and which spec).
- Ship Y (and which spec is ready).
- Pause Z to focus on the gap.

## 10. Emit a "Gaps to close before next retro" section

Any DB field, support theme, or GA4 check that was skipped this run goes here so the next retro doesn't repeat the same blind spot. If nothing was skipped, omit the section.

## Output rules

- **Do not write retro output into the repo.** `Documentation/retros/` is retired (deleted 2026-07-19) — committed retro files published business metrics in a public repo. The retro's artifacts are the chat output and the CLAUDE.md baseline block; historical numbers are re-queried from prod DB when needed.
- Two screens max.
- Numbers in tables.
- "Numbers" section (DB), "Funnel by origin" table (section 1a), "AI usage" table (section 1b), and "Traffic Sources" section (GA4) all required.
- Work-mix bucket shares and the treadmill flag are required output, even when nothing is flagged ("acquisition 40% — no flag").
- Recommendation in one paragraph.
- Do not list five things. The point of the retro is to force a single decision.
