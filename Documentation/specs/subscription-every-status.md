# Subscription section renders every Stripe status on /account

Closes https://github.com/2anki/server/issues/4238

### Trio synthesis
- **PM**: retention lever for `past_due` is "Update payment", cancel is secondary and goes through the per-id route; the `cancelled` state becomes reachable for 30 days with no offer; two `_shown` events prove the dead states now render.
- **Designer**: mirror the active layout; Update payment primary, Cancel secondary; no pause offer on `past_due`; cancelled = muted "Ended <date>" plus a payment-failed reason line, no resubscribe CTA here (PlanDetails above owns "See plans"); a fetch error must never impersonate the claim/mismatch state.
- **Engineer**: every code-map claim in the issue verified TRUE; `GET /api/users/subscription-status` already lists `'all'` statuses, so the fix is frontend-driven; the pause path 422s on `past_due`; gate the Stripe fetch on `subscriber || locals.subscriptionInfo.email` (exists today); the filenames trip the hard rail.
- **Agreement**: frontend-driven fix, per-id `immediate` cancel, Update payment primary, no pause offer, 30-day cancelled window, no Stripe round-trip for users who never paid.
- **Conflict**: (1) the issue asked to "surface the pause/downgrade offer" on `past_due`; all three reject it (pause calls `findActiveStripeSubscriptions` → 422 on `past_due`; no downgrade offer exists). Dropped, recorded as a decision. (2) Gate mechanism: PM proposed a new `hadRecentSubscription` local; engineer and designer reuse the existing `locals.subscriptionInfo` (verified: `getSubscriptionInfo`'s payer-email query has no `active` filter). Reuse wins; the 30-day window lives in `deriveView`. (3) Designer wants `cancellation_reason` on the summary (one field mapped in the controller) vs engineer's "no server change". Included: one field, and it powers the "why it ended" line that answers the reporter's actual confusion.
- **Resulting plan**: add `past_due` and a 30-day `cancelled` view to `deriveView`, widen the section gate, wire Cancel to the per-id route, map `cancellation_details.reason` through the status endpoint, 5 i18n keys × 10 locales, 2 parity events; the PR is hard-rail and waits for Alexander.

## Outcome

A logged-in user whose Stripe subscription is `past_due` or ended within the last 30 days sees a truthful subscription section with one working action, instead of "We can't find your subscription" or nothing. Success: after ship, `subscription_past_due_shown` and `subscription_ended_shown` are non-zero at day 7 (they are structurally zero today), and ≥60% of `past_due` renders lead to `subscription_manage_billing_clicked` or a per-id `subscription_cancelled` within 30 days.

**Goal alignment**: cancellation owns 78% lifecycle churn. A section that renders nothing pushes self-serve actions into the support queue at the exact moment a user decides to stay or go. `past_due` is involuntary churn we can recover without a discount by leading with "Update payment".

## Problem

User 13341 wrote in: "I would like to cancel my subscription however it is not letting me on the site." Stripe had auto-cancelled for `payment_failed` 67 minutes earlier. Two verified gaps:

- `past_due`: the webhook keeps `subscriptions.active = true` (`ACCESS_GRANTING_STATUSES` in `src/lib/integrations/stripe.ts:133`), so `locals.subscriber` is true and the section renders, but `deriveView` only matches `'active'` → `kind: 'none'` → the claim/mismatch block ("We can't find your subscription on this account") with no cancel button. The collection route `POST /api/users/cancel-subscription` lists `'active'` only and 422s. No working cancel path exists.
- `canceled`: `customer.subscription.deleted` flips `active = false`, `subscriber` is false, `SubscriptionManagement.tsx:284` returns `null`. The existing `kind: 'cancelled'` branch is unreachable in production.

The data is already on the wire: `getSubscriptionStatus` → `findRecentStripeSubscriptions` → `listStripeSubscriptionsFor(email, 'all')` returns `past_due` and `canceled` summaries. The frontend discards them.

## Riskiest assumption

The per-id route `POST /api/users/subscriptions/:id/cancel` (`cancelSubscriptionById`, ownership via the `'all'` list, mode `immediate` → `stripe.subscriptions.cancel`) succeeds on a `past_due` subscription.

**Smallest test**: a Jest case in `src/services/SubscriptionService.test.ts` with a `past_due` fixture asserting `cancelSubscriptionById` reaches `stripe.subscriptions.cancel` and flips the local row inactive, plus one Stripe test-mode call against a `past_due` sub before wiring the button. If Stripe rejects it, the button is dead and the scope changes.

## What this removes

The lie: a paying, mid-dunning user is no longer told "We can't find your subscription" with a claim form. The claim/mismatch block now means "we looked and found nothing", never "we couldn't look" or "we found one and dropped it".

## Scope

**In**
- `deriveView` (`web/src/lib/hooks/useStripeSubscriptions.ts`): `status === 'past_due' || 'unpaid'` → `{ kind: 'past_due' }`; `canceled` with `canceled_at` within 30 days → `{ kind: 'cancelled' }`, older → `none`. Expose `isError`.
- `SubscriptionManagement.tsx`: gate render and the `useStripeSubscriptions` `enabled` flag on `subscriber || locals.subscriptionInfo?.email != null` (both null-returns). New `past_due` branch: status line, explanation, actions row with **Update payment details** (`STRIPE_CUSTOMER_PORTAL_URL`, primary) and **Cancel subscription** (secondary) → `CancelFlow` → `usePerSubscriptionCancellation(id, 'immediate')`. Never the collection route. On `isError`, render the load-failed line and suppress the claim/mismatch block.
- `cancelled` branch: muted "Ended <date>. Previous plan: <plan>." plus "Your subscription ended because your payment didn't go through." when `cancellation_reason === 'payment_failed'`. No button.
- Server, one field: `getSubscriptionStatus` (`src/controllers/UsersControllers.ts:711`) maps `cancellation_details?.reason ?? null` to `cancellation_reason` on the summary; type added in `web/src/lib/backend/getSubscriptionStatus.ts`.
- Analytics: `subscription_past_due_shown`, `subscription_ended_shown` in both `web/src/lib/analytics/events.ts` and `src/types/AnalyticsEvents.ts` (parity test). `subscription_manage_billing_clicked` gains `from: 'past_due'`.
- i18n: 5 keys × 10 locales (see Design notes). Changelog JSON in the same PR.

**Out (decided)**
- No pause or downgrade offer on `past_due`: `pauseSubscription` lists `'active'` only and would 422; no downgrade offer exists. The issue's "surface the pause/downgrade retention offer" is explicitly not built; the retention lever is Update payment.
- No offer or resubscribe CTA on `cancelled`; `PlanDetails` above already shows "See plans".
- No failed-payment / dunning / cancellation email (Stripe Revenue Recovery sends them).
- Do not widen the collection cancel route's Stripe filter.
- Do not touch the 30-day session JWT; the logged-out entry point is a separate issue.
- Do not fire the Stripe fetch for users with no `subscriptions` row.

## User story

As a subscriber whose card just failed, I want /account to show my subscription with a way to fix payment or cancel, so I don't have to email support to stay or leave.

## Acceptance criteria

- [ ] `past_due`: section renders plan, "Your payment didn't go through", explanation, Update payment (portal, fires `subscription_manage_billing_clicked` `from:'past_due'`) and Cancel subscription. Confirming cancel calls `POST /api/users/subscriptions/:id/cancel` with `immediate`, refetches, and renders the `cancelled` state. `subscription_past_due_shown` fires once per render. No pause card.
- [ ] `canceled` within 30 days with `subscriber === false`: section renders "Ended <date>. Previous plan: <plan>." with no button; the payment-failed line shows only when `cancellation_reason === 'payment_failed'`. `subscription_ended_shown` fires once.
- [ ] `canceled` older than 30 days: no section, no fetch beyond the one gated call.
- [ ] No `subscriptions` row at all: no section, no `subscription-status` request.
- [ ] `active`, `scheduled`, `paused`, multiple-active: unchanged (existing Vitest cases still pass byte-for-byte).
- [ ] Status fetch error: load-failed line, claim/mismatch block hidden.
- [ ] Both new events present in both `KNOWN_EVENTS` sets (`events.parity.test.ts` green); all 5 keys in all 10 `account.json` files (`SubscriptionManagement.i18n.test.tsx` green).
- [ ] Golden path `web/tests/golden-path.spec.ts` gains a `past_due` mock asserting a working cancel control at 375px.

## Leading indicator

`subscription_past_due_shown` / `subscription_ended_shown` at `/api/ops/metrics`: from 0 to non-zero at the day-7 check. Secondary: "can't cancel on the site" support contacts from authenticated users trend to zero over the following month.

## Open questions for the engineer

1. Confirm in Stripe test mode that `subscriptions.cancel` accepts a `past_due` sub (riskiest assumption) before wiring the button.
2. `getSubscriptionInfo`'s inactive fallback matches on payer `email` only, so a churned cross-email user (`linked_email` row, `active = false`) still renders nothing. Acceptable for v1? Recommend yes; note it in the PR body.
3. Does the Stripe Customer Portal (dashboard config) allow payment-method update for a `past_due` customer? Not verifiable from the repo. Check Billing → Customer portal before ship so the primary button is truthful; if off, flag rather than build around it.

## Design notes

Mirror the active layout exactly: `styles.statusLine`, `sharedStyles.smallDescription`, `styles.actions` with `manageBillingButton` + `secondaryButton`. Update payment leads because a failing card is usually an expired card, not a decision to leave; Cancel is one click away and works, which is the whole bug. The cancelled state reuses `styles.statusLineMuted`. Loading shows `subscription.readingSubscription` before any kind is known, so `past_due` users never flash the wrong state.

New keys under `subscription.*` in `web/src/lib/i18n/locales/{de,en,es,fr,it,ja,nl,pl,pt,ru}/account.json` (English in all 10 as a stopgap, flag for native review):

| Key | English |
|---|---|
| `subscription.pastDueTitle` | Your payment didn't go through |
| `subscription.pastDueBody` | We couldn't charge your card for {{plan}}. We'll try again over the next few days. Update your payment details to keep your subscription. |
| `subscription.pastDueBodyNoPlan` | We couldn't charge your card. We'll try again over the next few days. Update your payment details to keep your subscription. |
| `subscription.endedPaymentFailed` | Your subscription ended because your payment didn't go through. |
| `subscription.statusLoadFailed` | We couldn't load your subscription just now. Refresh to try again. |

Reused: `subscription.updatePayment`, `subscription.cancelSubscription`, `subscription.endedPrefix`, `subscription.previousPlan`, `subscription.cancelFailed` (inline in `styles.helpDanger` on per-id 4xx/5xx, button re-enables), `subscription.cancelledImmediate`, `subscription.readingSubscription`.

## Technical pre-flight

- **Verified claims** (all TRUE): null-return on `!locals.subscriber` (`SubscriptionManagement.tsx:284`, second guard ~318); `subscriber` ← `configureUserLocal.ts:63` → `getIsSubscriber` (`AuthenticationService.ts:325`, DB `active` only); `deriveView` `'active'`-only; status endpoint lists `'all'` (`SubscriptionService.ts:96,135`); collection cancel 422s via `'active'` filter (`UsersControllers.ts:501-526`); per-id cancel ownership via `'all'` (`UsersControllers.ts:550`); `usePerSubscriptionCancellation` exists, wired only into the multi-sub rows; webhook keeps `active = true` on `past_due` and flips false on `deleted` (`WebhookRouter.ts:203,286`).
- **Platform check**: `STRIPE_CUSTOMER_PORTAL_URL` is a login-link portal (email-keyed, no session API), currently rendered only in the `active` branch. It does not replace the in-app cancel: the link is keyed on the Stripe email, which can differ from the account email, and it captures no cancellation reason. Portal past_due capability: not verified, dashboard toggle check needed (open question 3).
- **Layers**: `web` (primary), `controllers` (one field map). No routes, usecases, data_layer, migrations, or Python.
- **Files**: `web/src/lib/hooks/useStripeSubscriptions.ts`, `web/src/pages/AccountPage/components/SubscriptionManagement.tsx`, `web/src/lib/backend/getSubscriptionStatus.ts`, `web/src/pages/AccountPage/hooks/usePerSubscriptionCancellation.ts` (reuse), `src/controllers/UsersControllers.ts`, `web/src/lib/i18n/locales/*/account.json`, `web/src/lib/analytics/events.ts`, `src/types/AnalyticsEvents.ts`, `web/tests/golden-path.spec.ts`.
- **Tests to extend**: `useStripeSubscriptions.test.tsx`, `SubscriptionManagement.test.tsx`, `SubscriptionManagement.i18n.test.tsx`, `SubscriptionService.test.ts` (past_due cancel fixture), `UsersControllers.test.ts` (`cancellation_reason` mapping), `golden-path.spec.ts:146` neighbour.
- **Effort**: S–M. Logic is one `deriveView` case and one UI branch on existing hooks and routes; the tax is 10 locales, the golden-path case, and the hard-rail review.
- **Hard rail**: yes. `hard_rails.py` globs `subscription` and `stripe`, which both filenames match. The PR goes ready with the review verdict posted and waits for Alexander; no `/ship` merge.
- **Security**: no new HTTP client, no user-controlled URL, per-id route already ownership-checked server-side. `cancellation_reason` is a Stripe enum, not user text.
