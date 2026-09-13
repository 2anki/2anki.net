# Spec: Prepaid AI credits, part 2 of 2 (credit pack purchase and copy)

Issue: https://github.com/2anki/server/issues/4425. Depends on [ai-credits-1.md](ai-credits-1.md) being merged. Gets its own spec PR when part 1 lands; do not implement on the part 1 branch.

### Trio synthesis
- PM: one pack, one price, prepaid, revenue recognized on consumption; no pricing-page card.
- Designer: buy actions live in context only (badge link, built-without-AI notice, account line); pricing benefit lines keep "unlimited" on conversions and describe AI as included; FAQ carries the "monthly allowance" disclosure.
- Engineer: mirror `CreatePassCheckoutUseCase` and the `checkout.session.completed` branch, idempotent on `stripe_session_id`; both files are hard rails; iOS needs a consumable and a new grant branch in the redeem use case.
- Agreement: Stripe Checkout `mode: payment`, grant written from the verified webhook, never client-trusted, 90-day expiry, signed-in paying or pass users only.
- Conflict: designer's free-tier line ("start free, top up when you need more") dropped, the AI gate does not open to free users in this iteration.
- Resulting plan: pack route + use case + webhook grant + three buy entry points + pricing and FAQ copy in 10 locales + changelog + T+30d review issue.

**Outcome**: A user at zero can be back on AI in under a minute without changing plan. Metric: packs sold and `ai_credits_pack_purchased` per week, and the share of `ai_credits_exhausted` users who buy within 7 days.

**Goal alignment**: Margin and a small prepaid revenue line. Read in Stripe (one-time payments on the pack Price) and `/ops` AI usage.

**Problem**: Part 1 stops AI at zero. Without a top-up the only recovery is waiting for the window to reset or writing to support.

**Riskiest assumption**: Users who hit zero want more AI enough to pay $5 rather than accept the non-AI deck. Smallest test: ship, read the 7-day buy rate among exhausted users at T+30d; under 10% means the pack earns its keep only as a support deflector and the copy should say so.

**What this removes**: The "contact support" path for AI limits. No card on `/pricing`; the pack is sold only where the limit is felt.

**Primary action**: Add credits.

**Default behavior**: Nothing changes for users above zero. The pack never auto-refills.

**Surface vocabulary**: Stripe Checkout as passes use it (`/api/checkout/pass/*`), the upload result warning stack, `/account` plan details, `/pricing` benefit lists and FAQ.

**Scope**
- In: one-time Stripe Price (`CREDIT_PACK_PRICE_ID`), `POST /api/checkout/credit-pack`, `CreateCreditPackCheckoutUseCase`, grant branch in `WebhookRouter` `checkout.session.completed` keyed on `session.id`, buy actions on the badge link, the built-without-AI notice and the account line, chat and photo at-zero notices, pricing benefit lines, FAQ entry, Day Pass FAQ rewrite, 10 locales, changelog, `ai_credits_pack_purchased` event, T+30d adoption review issue.
- Out: multiple pack sizes, auto-refill, gifting, anonymous purchase, iOS (app issue 74 plus the server redeem branch, separate PR), opening AI to free users.

**User story**: As a paying user who ran out of AI credits, I want to buy more in place so my next upload uses AI again.

**Acceptance criteria**
- [ ] "Add 250 credits for $5" opens Stripe Checkout (`mode: payment`, `invoice_creation` on, metadata `credit_pack=250`, `user_id`), `success_url` back to the originating page, `cancel_url` the same page.
- [ ] The verified webhook (HMAC on raw body, existing path) writes one `ai_credit_grants` row (`source=pack`, 250, `expires_at` = now + 90 days, `stripe_session_id`); a replayed event is a no-op via the unique constraint (`23505` caught, mirroring `UserPassRepository`).
- [ ] The badge and account line reflect the grant on return without a manual reload.
- [ ] Built-without-AI notice: title "Built without AI", body from part 1, primary "Add 250 credits for $5", tertiary "What are AI credits?".
- [ ] Chat at zero: "You're out of AI credits. Chat runs on Claude, so it needs AI credits. Add 250 for $5 to keep going." Photo: same with "Photo to deck reads your image with Claude". Primary "Add credits", tertiary "What are AI credits?". Neutral card, never blocks the rest of the page.
- [ ] Pricing benefit lines: passes "300 AI credits included" (500, 1 500 by kind); Unlimited "300 AI credits a month, add more anytime". The "AI (Claude)" table row shows the number, not a checkmark. Nowhere says AI is unlimited.
- [ ] FAQ "What are AI credits?": "AI credits pay for the work Claude does, writing cards, reading a photo, or answering in chat. Longer or more detailed pages use a few more credits than short ones. Turning notes into cards from your file's own structure never uses credits. If your credits run out, conversions keep working without AI, while photo to deck and chat pause until you add more. A pack of 250 credits is $5. Every plan includes a monthly or per-pass allowance."
- [ ] Day Pass FAQ first sentence: "Day Pass ({{dayPrice}}) gives 24 hours of unlimited conversions, with AI credits included."
- [ ] Price strings come from the Stripe Price per locale currency, never hardcoded.
- [ ] `ai_credits_pack_purchased` in both `KNOWN_EVENTS`; changelog entry; T+30d review issue created at merge.
- [ ] All strings in 10 locales; "top up", "allowance" and "included" flagged for a native-speaker pass; the FAQ's monthly-allowance disclosure must survive translation.

**Open questions**: Stripe Price id and currency variants (USD only at first, like passes?). Whether the Apple consumable ships before or after; the server redeem branch is its own PR.

**Out of scope (next iteration)**: iOS consumable (`aicredits.250`) with a grant branch in `RedeemAppleTransactionUseCase`; starter credits for free users.

## Technical pre-flight (engineer)

- Layers: `routes` (`CheckoutRouter`, `WebhookRouter`), `controllers` (`PassCheckoutController` sibling), `usecases/checkout`, `data_layer` (grant insert from part 1's repository), `web` (three buy entry points, notices, pricing, FAQ, i18n), changelog.
- Hard rails: any path containing `checkout` or `webhook`. Ready with the review verdict, waits for Alexander.
- Security: grant only from the signature-verified webhook; idempotent on `stripe_session_id`; the client never sends a balance or an amount.
- Tests: checkout session params; webhook grant + replay; web notices and pricing lines; events parity test covers the new event.
- Effort: M. Mostly a pass mirror plus copy across 10 locales.
