# Spec: Prepaid AI credits, part 1 of 2 (ledger, enforcement, notices, balance)

Issue: https://github.com/2anki/server/issues/4425. Part 2 (credit pack purchase): [ai-credits-2.md](ai-credits-2.md). iOS mirror: https://github.com/Laer-Smart/2anki.app/issues/74.

### Trio synthesis
- PM: margin protection, not growth. Removes the $50/day breaker and its opaque 429. Riskiest assumption: 300 credits per period is invisible to normal Unlimited subscribers.
- Designer: balance lives on the AI badge and one account line only; running out is a soft landing (deck still ships); low threshold must be a fixed count, not a percentage.
- Engineer: the 3 unguarded Claude call sites and the pass/webhook mirror are confirmed; subscription period is item-level in `subscriptions.payload` and can be stale; overshoot bound is N concurrent conversions, not one; iOS consumable needs a new redeem branch, not the pass path.
- Agreement: cost-backed abstract credits (1 credit = $0.01 of recorded AI cost, internal), derived plan allowances with grants stored only for packs and manual comps, soft limit with the standard parser as fallback, prepaid only, Stripe collects and our `ai_usage_recorded` ledger enforces.
- Conflict: designer proposed a starter grant, a free-tier FAQ line and opening the AI gate to non-paying users; resolved out of scope, the `isPaying` AI gate is unchanged, packs are for paying and pass users. Designer's "Unlimited sees no balance" resolved the other way: every allowance holder sees balance and top-up. Designer's notice body ("ran out during this conversion") replaced: a conversion that starts with AI finishes with AI. PM's "atomic check-and-debit" replaced by the engineer's eventual-consistency stance.
- Resulting plan: PR1 ships the ledger, allowance resolver, one guard at all 7 call sites, the non-AI fallback with a warning, the balance endpoint, badge and account line; PR2 ships the pack.

**Outcome**: No single account can spend more AI cost than its plan allowance (plus one in-flight conversion per concurrent run). Worst single-account 24h AI spend drops from $31 to the allowance. Guardrail: conversion success rate and deck downloads stay flat, because the fallback keeps decks building.

**Goal alignment**: Margin. Read AI cost per plan cohort against net revenue in `/ops` AI usage weekly; `ai_credits_exhausted` distinct users at day 7.

**Problem**: A $6 24h pass ran 184 comprehensive conversions in 24 hours and cost $31.33, 42% of that week's AI spend. The only guard is a rolling $50/24h breaker per user, the same for every plan, which ends in a 429 "contact support". Backfill over 90 days: 10 of 31 AI-using subscriber-months exceeded $3 and 9 exceeded $6 (max $46.27); 2 of 276 day passes exceeded $3; 0 of 60 week passes and 0 of 8 semester passes exceeded theirs.

**Riskiest assumption**: 300 credits per period does not touch normal Unlimited use. Answer from the backfill above: it stops about 3 subscriber-months a month, every one of which already costs more in AI than the $6 it pays. Accepted, with the fallback making it a downgrade rather than a wall. Re-read the same query 30 days after PR1 ships.

**Smallest test**: Done (the 90-day backfill query in the issue thread). Day-7 check after ship: distinct users firing `ai_credits_exhausted`, and whether any of them is a subscriber whose 30-day cost was under $3.

**What this removes**: `AI_SPEND_DAILY_CAP_USD`, `AiSpendCapError` and the 429 path; the `$25` alert email stays only as an ops signal on packs. Nothing new on `/pricing` or the converter for the 97% who never turn AI on.

**Primary action**: Download your deck. The credit system is invisible until zero, and at zero the deck still downloads.

**Default behavior**: Every plan carries its allowance automatically. At zero, conversion runs the standard parser; chat and photo-to-deck pause. Nothing goes negative, nothing is billed later.

**Surface vocabulary**: `/upload` AI badge, `/account` plan details, the upload result warning stack (siblings: sync-size, stray-cloze, empty-back).

**Allowances** (1 credit = $0.01 of recorded cost, internal only; rule ≈ 50% of net after Stripe):

| plan | credits | window |
|---|---|---|
| 24h pass | 300 | `user_passes.expires_at` minus 24h to `expires_at` |
| 7d pass | 500 | same, 7 days |
| 120d pass | 1 500 | same, 120 days |
| Unlimited monthly and annual | 300 | item-level `current_period_start` to `current_period_end` from `subscriptions.payload`; rolling 30 days when absent or elapsed |
| legacy $2 / €2 | 100 | same as Unlimited |
| lifetime (`patreon`) and `ankify_access` comp | 300 | calendar month |
| pack (part 2) | 250 | 90 days from purchase |

Balance = allowance + unexpired grants − Σ `ai_usage_recorded.cost_usd` in the window ÷ 0.01. Allowances are derived on every check, never materialized, so periods reset without a cron (`STRIPE_SYNC_ON_STARTUP` is off). Grant rows exist only for packs and manual comps.

**Scope**
- In: migration `ai_credit_grants` + kanel; allowance resolver; `assertAiBudget(owner)` extending `aiSpendGuard.ts`, called before every Claude call at all 7 sites; start-of-conversion pre-check from byte size; non-AI fallback + warning in `UploadService`; calm stop for chat and photo; `GET /api/ai/credits` typed balance; AI badge readout; account line; `ai_credits_exhausted` event in both `KNOWN_EVENTS`; delete the $50 breaker.
- Out: pack purchase (part 2), pricing and FAQ copy (part 2), opening AI to non-paying users, starter grants, negative balances, overage, per-surface pricing, a balance meter anywhere else, Metronome, Stripe Billing Credits.

**User story**: As a paying user, I want AI to work without thinking about it and my deck to still build if I run out, so I never hit a wall I do not understand.

**Acceptance criteria**
- [ ] Migration `ai_credit_grants` (`user_id` FK cascade, `source` in `pack|comp`, `amount_credits` integer, `expires_at`, `stripe_session_id` unique nullable, `created_at`) with `src/data_layer/public/AiCreditGrants.ts` regenerated in the same PR.
- [ ] Allowance resolver returns `{ credits, windowStart, windowEnd }` per the table for pass, subscription, legacy, lifetime, comp; unit tests per plan shape including a stale subscription period falling back to rolling 30 days.
- [ ] Balance query asserted as generated SQL with pg-dialect knex (`(props->>'cost_usd')::numeric` is PG-only).
- [ ] `assertAiBudget` runs before every Claude call in `ClaudeService`, `claudeFileConversion`, `generateDeckInfoFromPdfImages`, `ChatUseCase`, `PhotoToFlashcardsUseCase`, `TagCardsUseCase`, `AINoteTypeUseCase`; fails open on a read error; skips anonymous (the `isPaying` gate already excludes them from AI).
- [ ] A conversion checks the balance once at start (byte-size estimate: bytes ÷ 4 tokens × blended price); once started with AI it finishes with AI. Overshoot is bounded to the in-flight conversions of that user. Documented in the PR body.
- [ ] At zero, an upload converts with the standard parser and the result carries the warning "You're out of AI credits, so this deck was built without AI. Add credits to use AI on the next upload." Ranked under sync-size and locked-PDF, above markdown-heuristic. No 4xx.
- [ ] At zero, chat and photo-to-deck return a coded `ai_credits_exhausted` response the client renders as a calm notice, not an error state (copy in part 2; part 1 ships the English string only).
- [ ] `GET /api/ai/credits` returns `{ credits, allowance, windowEnd, resets: 'period' | 'pass' | 'month' }`, mapped, never a raw row.
- [ ] AI badge (`on` state only): "180 AI credits left." in `tabular-nums`; at 25 or fewer the count turns `badgeWarning` and shows an "Add credits" link; at zero: "0 AI credits left. Your next deck is built without AI." Off, free and anonymous states unchanged.
- [ ] Account plan details: one line "180 AI credits, valid through 12 May 2027." plus "Add credits"; zero reads "0 AI credits." Every allowance holder sees it, Unlimited and lifetime included.
- [ ] `ai_credits_exhausted` fires once per user per window, listed in both `web/src/lib/analytics/events.ts` and `src/types/AnalyticsEvents.ts`.
- [ ] `AI_SPEND_DAILY_CAP_USD`, `AiSpendCapError` and their tests are deleted.
- [ ] Balance number animates old to new over ~400 ms; notices fade in 160 ms with a 4 px rise; both instant under `prefers-reduced-motion`.
- [ ] Strings land in all 10 locales; "top up" and "allowance" flagged for a native-speaker pass.

**Open questions**: none blocking. Blended price for the pre-check estimate: take it from `src/lib/claude/pricing.ts` for the default model.

**Out of scope (next iteration)**: pack purchase and copy (part 2), iOS consumable (app issue 74 plus a new grant branch in `RedeemAppleTransactionUseCase`), starter credits for free users.

## Technical pre-flight (engineer)

- Layers: migration + `src/data_layer/public` (kanel), `data_layer` (`AiCreditGrantsRepository`, balance query in `AiUsageMetricsRepository`), `lib/claude` (`aiSpendGuard.ts`, allowance resolver, pricing), `usecases` (3 new guard wirings), `services` (`UploadService` fallback; AI enablement lives in `worker.ts:150/169` and `PrepareDeck.ts:790`, not the fingerprint gate at `UploadService.ts:550`), `routes/controllers` (`GET /api/ai/credits` mirroring `/api/users/usage`), `web` (badge, account line, events).
- Hard rails: `migrations/`, `src/data_layer/public/`, any path containing `subscription`. PR goes ready with the review verdict and waits for Alexander.
- Concurrency: eventually consistent, no reservation. Prepaid plus fail-open makes a row lock not worth it.
- Security: balance is server-computed; response is a mapped shape; no client input reaches the SQL beyond `owner` from `res.locals`.
- Tests: resolver per plan shape; generated-SQL assertion; each newly guarded use case throws or degrades over budget with only the Anthropic SDK mocked; `UploadService` fallback + warning header; deletion of the breaker tests.
- Effort: L. Migration + kanel, resolver across three plan shapes with the stale-period wrinkle, three guard wirings, fallback in a 1 800-line service, endpoint, badge, SQL test.
