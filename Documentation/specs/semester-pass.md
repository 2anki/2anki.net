# Semester Pass and term-start winback

Spec for #4305. Trio/engineer-consulted 2026-09-01. Hard rail
(pricing/checkout/webhook/passes) and blocked on Stripe-side inputs, so this
ships as a spec; /implement takes the PR over once the decisions land.

## Problem

Churn is exam-calendar shaped; day and week passes exist but nothing covers a
term. Lapsed students who would pay for a semester either cancel a monthly sub
or do not return.

## Build (engineer-verified: no migration, no kanel)

pass kind '120d' — a TS-union + wiring extension, no schema change:
- PassKind union (UserPassRepository), passDurations (AnonymousPassKind,
  PASS_DURATION_MS, isAnonymousPassKind), passKindLabel -> "Semester Pass".
- ALL THREE hardcoded '24h'||'7d' gates must extend together: the
  WebhookRouter grant branch, isAnonymousPassKind, and
  ValidateAnonymousPassUseCase:69 — missing one takes money and grants
  nothing. Prefer refactoring the three to one shared predicate in this PR.
- CheckoutRouter: POST /api/checkout/pass/120d off PASS_120D_PRICE_ID (503
  when unset); config WARN_VARS + env.example entries.
- Web: third PricingCard in PassCards (grid is hardcoded 2-col — needs the
  responsive reflow, designer call), PricingPage handler union, Backend
  startPassCheckout map, AccessBanner '120d' label, pricing + pricingtable
  i18n keys in all 10 locales.
- Winback v1: reuse the existing campaign-parameterized send-pass-winback ops
  command with a new campaign string at term start (zero new machinery).
  Audience = expired pass buyers. A lapsed-SUBSCRIBER winback needs a new
  audience query and is a follow-up, not this PR.

## Decisions Alexander owns (blocking)

1. Create the Stripe one-time Price; provide PASS_120D_PRICE_ID (prod + .env).
2. Price point — envelope from the corpus: $24-32 (below 4x monthly $31.96,
   above the annual per-4-month slice $21.33, so it neither undercuts annual
   nor reads as no deal). The number is yours.
3. Logged-in-only purchase for v1 (recommended: target is returning accounts;
   skips the anonymous claim-flow extension) — or anonymous parity with
   day/week.
4. Winback audience for the term-start send: expired-pass buyers now, lapsed
   subscribers as follow-up?

## Out of scope

Lapsed-subscriber winback query; UpsellCard changes; any subscription pricing
change; anonymous purchase (unless decision 3 flips).

## Tests

CheckoutRouter 503-unset/200-set; WebhookRouter grants ~120d; passDurations +
label units; PassCards renders 3; AccessBanner label; i18n parity; winback
repo selects a lapsed semester buyer if PAID_PASS_KINDS gains '120d'.

## Metric

Semester-pass sales/week; 6-month return rate of lapsed students; cancel-flow
exits choosing a pass. Read via /api/ops/metrics + Stripe.
