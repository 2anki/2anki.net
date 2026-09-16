## Spec: Credit pack purchase (AI credits — part 2)

### Trio synthesis
- **PM**: revenue-upside/retention add-on (PR1 already stopped the cost leak). Outcome = credit-pack attach rate ≥5% of zero-balance users within 30 days. One Stripe Price, one route/use case, one webhook grant branch, buy link on 3 surfaces. Real demand signal already in hand (2026-09-16 support contact).
- **Designer**: one shared `BuyCreditsButton` control placed three ways (result notice = tertiary link, upload badge = compact "Buy credits" link at ≤25/0 credits only, account line = secondary button always visible with an allowance). One SKU, no size picker. Server-side allowlisted redirect (no open-redirect risk). Calm, non-celebratory confirmation copy. Flags a 4th placement (ChatPanel exhaustion notice, since chat has no non-AI fallback) as an explicit extension for Alexander to accept or defer, not a silent default.
- **Engineer**: confirmed hard-rail (checkout + webhook path globs, independent of the "no new migration" fact — `ai_credit_grants` table already exists from PR1, reader-only, needs a writer added). Corrected two wrong claims from issue #4425's original text: the column is `amount_credits` not `amount_usd`, and `expires_at` is `notNullable`, not nullable. Flagged a real product edge case: pack credits are invisible while the buyer has no active plan/pass allowance (the balance calc short-circuits to null before reading grants) — recommends shipping write-only and documenting the limitation rather than expanding this PR into a read-side fix.
- **Agreement**: single $5/250-credit pack, signed-in only, mirrors `CreatePassCheckoutUseCase` (simplified — no anonymous branch), idempotent webhook grant via the existing unique `stripe_session_id` constraint (`insert().onConflict('stripe_session_id').ignore()`), no migration needed, no pricing-page card, hard-rail PR (Alexander merges from the GitHub UI).
- **Conflict**: designer's 4th (ChatPanel) placement — resolved by shipping the three-trigger default and listing chat as an explicit fast-follow decision below, not silently included or excluded.
- **Resulting plan**: build `CreateCreditPackCheckoutUseCase` + webhook grant branch + a shared `BuyCreditsButton` wired into the upload badge, account line, and conversion result notice; document the stranded-credits limitation; ship as a hard-rail PR.

### Outcome
Zero-balance users can top up instead of waiting for reset. Leading indicator: credit-pack purchases and the `credits_buy_clicked` → `credits_purchase_completed` conversion rate, read on the AI-usage ops page / `/api/ops/business/metrics`. Day-7 prod check: grants writing correctly, no webhook errors, at least one real purchase or a clear zero. T+30d adoption review: keep/remove verdict on attach rate (≥5% of zero-balance users bar) and whether repeat purchases signal the plan allowance itself needs revisiting.

### Goal alignment
Faster (removes a forced-wait dead end for a paying user) and revenue-positive. Not a cost fix — PR1 (#4426) already capped AI spend; this is pure upside.

### Problem
One day after the AI-credits system (#4426) went live, a paying subscriber hit zero credits with roughly three weeks until reset and asked support "is there a way to increase AI credits." Today's answer is no — the zero-balance state (`aicredits.json`'s `zero` string) has no recourse but to wait.

### Riskiest assumption
Not the price/size (a one-constant change, cheap to tune later) — whether enough zero-balance users will actually pay to justify the surface's ongoing maintenance. The concrete support instance is a first data point, not proof.

### Smallest test
Ship the thin version (one SKU, three triggers) and read the T+30d attach rate. Near-zero attach at 30 days means wrong price/placement or the demand isn't real; ≥5% means keep and consider tuning size/price.

### What this removes
No feature or copy deleted. This completes an existing dead-end state (the zero-balance message has no action today) rather than adding a new toggle or tier.

### Scope — in
- One-time Stripe Price: $5 for 250 credits, 90-day expiry from purchase.
- `POST /api/checkout/credit-pack`, signed-in only (`RequireAuthentication`), `CreateCreditPackCheckoutUseCase` mirroring `CreatePassCheckoutUseCase` minus the anonymous branch.
- Server-side allowlisted `success_url`/`cancel_url` keyed off a `source` enum (`credits_conversion` / `credits_badge` / `credits_account`) — never a client-supplied redirect URL.
- Webhook grant branch in `checkout.session.completed`: derive credits from a server-side SKU constant (never trust a client-supplied amount), insert into `ai_credit_grants` (`source: 'pack'`, `amount_credits: 250`, `expires_at: purchaseTime + 90d`) via `insert().onConflict('stripe_session_id').ignore()` for idempotency on webhook redelivery.
- One shared `BuyCreditsButton` component (variants: `link`, `secondary`) wired into three surfaces:
  1. Conversion result "built without AI" notice — tertiary link, "Buy 250 credits for $5."
  2. Upload-page AI-credits badge — compact "Buy credits" link, shown only at ≤25 credits or zero.
  3. Account-page credits line — secondary button, shown whenever the user has an active allowance (not gated to low balance).
- Post-purchase: return to originating page, invalidate the AI-credits query so the balance updates in place, calm one-line confirmation ("250 credits added. Valid through {{date}}."), strip the query param.
- Cancelled checkout: silent return, no error shown (a cancel is a choice, not a failure).
- Failed-to-start checkout: inline "Couldn't start checkout. Try again." retry text.
- i18n across all 10 locales (new `aicredits.json` keys; localized price display where the pass-price formatting source already supports it, USD fallback acceptable for v1 otherwise).
- Both `KNOWN_EVENTS` allowlists (`web/src/lib/analytics/events.ts` + `src/types/AnalyticsEvents.ts`) get `credits_buy_clicked` and `credits_purchase_completed` in the same PR.
- Changelog entry, T+30d adoption-review issue filed at merge.

### Scope — out
- Balance dashboard for everyone, Metronome, per-surface pricing, overage billing, renaming the Unlimited plan, cross-session anonymous credits (all per issue #4425).
- The per-conversion usage-visibility feature (separate, parallel PR).
- A quantity/size picker — one SKU only.
- A pricing-page card for the pack.
- Refund/dispute claw-back of already-granted credits.
- **ChatPanel exhaustion notice as a 4th buy-link placement** — designer recommends it (chat has no non-AI fallback, so it's arguably the highest-intent moment), but it's not in the default scope. Decide explicitly before merge: ship it as a 4th placement in this PR, or file it as an immediate fast-follow. Do not add it silently.
- **Fixing the stranded-credits edge case** (see Known limitation below) — write-only for this PR; a fix would be a read-side change to `balance.ts` and is a separate decision.

### User story
As a paying user who has run out of AI credits before my plan resets, I want to buy more credits so my next deck builds with AI instead of falling back to the standard parser.

### Acceptance criteria
- [ ] Clicking any buy action opens Stripe Checkout (`mode: payment`, `credit_pack` metadata), never a client-controlled redirect URL.
- [ ] A successful `checkout.session.completed` webhook inserts exactly one `ai_credit_grants` row per session id, even under redelivery (idempotency test required).
- [ ] Credits amount and expiry are derived server-side from a SKU constant, never trusted from client/session metadata directly (a sanity check against `session.amount_total` or the price id, mirroring the existing lifetime-branch pattern).
- [ ] User returns to the originating surface with the balance refetched automatically — no manual reload.
- [ ] Confirmation copy: "250 credits added. Valid through {{date}}." — factual, not celebratory (no exclamation marks, no "Thanks!").
- [ ] Cancelled checkout shows nothing extra; a failed-to-start checkout shows an inline retry message.
- [ ] Buy actions appear exactly per the three-surface rules above (badge: ≤25 or zero only; account: any active-allowance state; result notice: only on the built-without-AI outcome).
- [ ] Copy ships in all 10 locales; `parity.test.ts` passes.
- [ ] `credits_buy_clicked`/`credits_purchase_completed` exist identically in both `KNOWN_EVENTS` allowlists; the events-parity test passes.

### Known limitation (document, do not fix here)
Pack credits are added to a user's balance only while they have an active plan/pass allowance — `computeAiCreditBalance` returns `null` (ignoring grants entirely) when `resolveAllowance` is null, i.e. no active subscription, pass, or lifetime/comp access. A user who buys a pack and then lets their pass/subscription lapse before using it up loses visibility into those credits until they have an active plan again (the row itself survives up to 90 days; it isn't deleted). Document this in the PR body and in the "What are AI credits?" FAQ copy ("credits are used while you have an active plan"). If this proves to be a real problem, the fix is a deliberate read-side change to `balance.ts` — a separate decision, not smuggled into this PR.

### Design notes
- One shared `BuyCreditsButton` (variants `link`/`secondary`, owns pending/error state) backing a `startCreditPackCheckout(source)` client helper mirroring `startUnlimitedUpgrade.ts`/`Backend.startPassCheckout`.
- Copy (VOICE-checked, sentence case, no exclamation marks, no "add-on"/"top up" as nouns):
  - Account/result button: "Buy 250 credits for $5"
  - Badge (compact): "Buy credits"
  - Pending label: "Starting checkout"
  - Start-failure: "Couldn't start checkout. Try again."
  - Result notice: "You're out of AI credits, so this deck was built without AI. Credits reset on {{date}}."
  - Confirmation: "250 credits added. Valid through {{date}}."
  - Optional account helper: "Valid for 90 days."
- Localize the price display through the same formatting source the pricing page uses for pass prices where available; fixed "$5" is an acceptable v1 fallback with a currency-format fast-follow noted.
- Open question for the implementing engineer: confirm whether the conversion result currently renders PR1's non-blocking "built without AI" success notice, or the blocking `ai_credits_exhausted` error message (or both, on different surfaces) — attach the buy link to whichever actually renders, and say so in the PR body if it required a small server response change to expose a flag.

### Technical pre-flight
- Files to add: `src/usecases/checkout/CreateCreditPackCheckoutUseCase.ts` (+test), `src/controllers/CreditPackCheckoutController.ts` (+test), a writer method + `IAiCreditGrantsWriter` interface on `src/data_layer/AiCreditGrantsRepository.ts` (+test, including a generated-SQL test for the `insert().onConflict(...).ignore()` shape per `testing.md`'s raw-SQL rule), `web/src/lib/backend/startCreditPackCheckout.ts`, `web/src/components/BuyCreditsButton/BuyCreditsButton.tsx`.
- Files to edit: `src/routes/CheckoutRouter.ts`, `src/routes/WebhookRouter.ts` (+ its test, including the idempotent-redelivery test), `src/env.example` (`CREDIT_PACK_PRICE_ID`), `web/src/lib/backend/Backend.ts`, `web/src/pages/UploadPage/components/AiCreditsReadout.tsx`, `web/src/pages/AccountPage/components/AiCreditsAccountLine.tsx`, the conversion-result presenter for the built-without-AI notice, `web/src/pages/UploadPage/UploadPage.tsx` + `web/src/pages/AccountPage/AccountPage.tsx` (handle `?credits=added` return, mirroring the existing `from=pass` handler), all 10 `web/src/lib/i18n/locales/*/aicredits.json`, both `KNOWN_EVENTS` files, a changelog JSON.
- No migration needed — `ai_credit_grants` (PR1) already has every column this needs.
- Hard-rail: checkout + webhook + pricing-adjacent paths all trip `hard_rails.py`'s `NAME_GLOBS`. Run `/security-review` before merge (checkout redirect allowlist + idempotent grant are the two load-bearing correctness/security points). Ships to ready with the review verdict posted; Alexander merges from the GitHub UI.
- Effort: M (backend is S-M, a subset of an existing pattern; the 10-locale copy + three web call sites + analytics parity + changelog + adoption issue push it to M).

### Open questions
1. Ship the ChatPanel exhaustion notice as a 4th buy-link placement in this PR, or defer to a fast-follow? (Designer recommends it; not default scope.)
2. Confirm which conversion-result UI (PR1's success notice vs. the blocking exhausted error) actually renders today, before wiring trigger A.
3. Two packs purchased before either expires: one rolling 90-day bucket from the most recent purchase, or independent per-pack expiries? Recommend the simpler rolling-window rule (the display only ever needs one date) unless there's a reason to track per-pack expiry.
