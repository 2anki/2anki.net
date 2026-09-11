# Spec: `/ops` v2 — Business tab (Stripe)

**Outcome**: Al opens `/ops/business` and within 5 seconds knows: are we earning more this month than last, are paying users churning, and are payments failing. Six numbers, one screen, ≤15 min stale. The Engineering tab stays at `/ops`, unchanged.

**Goal alignment**: The product only stays the go-to place if the business under it is healthy. Right now Al checks Stripe's dashboard manually; that friction means we look at it weekly instead of daily. Same-tab visibility makes "is this PR earning its complexity?" a daily question.

**Problem**: Engineering signals (latency, errors) and business signals (MRR, churn, failed payments) currently live in two different tools. We have no view that answers "are we growing?" alongside "are we healthy?" — and qualitative user feedback doesn't aggregate into a number, so it doesn't belong on this dashboard.

## Scope

**In:** Two tabs under `/ops` (Engineering default, Business). Six Stripe metrics on the Business tab: MRR, net new MRR MTD, active paying subs, trailing-30d churn %, failed payments last 7d, new paid conversions last 7d. 15-min server-side cache. Owner-only (404 for others).

**Out:** per-customer drill-down, refund tracking, cohort analysis, LTV, ARPU, Stripe webhooks, charts/sparklines/trend arrows in v2, historical Postgres snapshots, alerting, currency conversion (USD only — same as our Stripe account).

## Decision: compute on demand from Stripe API, do NOT persist snapshots

One reader (Al), 15-min cache, six aggregates. We considered reading from the local `subscriptions` table (already populated by `updateStripeSubscriptions`), but that job is **manual-only by design** (see follow-up below) — relying on it for freshness would couple the dashboard to deploy cadence. Calling Stripe directly with a server-side cache decouples them.

| Metric | Source |
|---|---|
| `mrr_usd` | Stripe `subscriptions.list({status: 'active'})` paginated, sum `items[].price.unit_amount × quantity`, normalize per-item by `recurring.interval` (yearly→/12, weekly→×4.33, daily→×30) |
| `active_paying_subs` | Same paginated list, count active rows |
| `net_new_mrr_mtd_usd` | Stripe `subscriptions.list({created: {gte: ts_mtd}})` and sum the same way |
| `new_paid_conversions_7d` | Stripe `subscriptions.list({created: {gte: ts_7d}})`, count |
| `churn_30d_pct` | Stripe `subscriptions.search('canceled_at>:ts_30d')`. Denominator: from the active list. Numerator: count of canceled rows in window |
| `failed_payments_7d` | Stripe `invoices.list({collection_method: 'charge_automatically', created: {gte: ts_7d}})` filtered to `status='open'` with `attempt_count > 0` |

`mrr_usd` and `active_paying_subs` share one paginated walk (don't refetch). Total: ~5 Stripe call series per refresh, ~480/day with 15-min cache. Well under rate limits, well under Sigma's price tag.

No new tables. No persisted snapshots. When we want trend lines (v3), add nightly snapshots then — the table shape will be obvious from a month of real usage.

## Follow-up (out of scope for this iteration)

**Automate `updateStripeSubscriptions`** later. The job currently only runs at startup when `STRIPE_SYNC_ON_STARTUP=true`. Putting it on a recurring schedule was rejected for this iteration — Al's call. Revisit when we have a clearer picture of: how stale the local `subscriptions` table actually gets in practice, whether dashboards or other features want a continuously fresh local mirror, and how much Stripe API budget we want to spend on background sync vs. on-demand reads. Likely path: a single configurable interval (env var) with explicit error budgets, not a hardcoded `setInterval`.

## Backend

`routes/OpsRouter.ts` adds one endpoint, same `RequireOpsAccess` gate:

```
GET /api/ops/business/metrics  →  RequireOpsAccess  →  OpsController.getBusinessMetrics
```

Layered path (matches existing convention):

- `controllers/OpsController.ts` — new `getBusinessMetrics` method.
- `usecases/ops/GetBusinessMetricsUseCase.ts` — orchestrates the six metric calls, returns the JSON shape below.
- `services/ops/BusinessMetricsService.ts` — owns the Stripe SDK client, all Stripe queries, and the in-memory `Map<string, { value, expiresAt }>` cache (15-min TTL). One method per metric. Reads `STRIPE_SECRET_KEY` from env via the existing `getStripe()` helper.
- No `data_layer` change. Stripe is the data layer here.

Response shape (flat, no nesting — matches the card grid):

```json
{
  "mrr_usd": 4820,
  "net_new_mrr_mtd_usd": 312,
  "active_paying_subs": 184,
  "churn_30d_pct": 2.1,
  "failed_payments_7d": 4,
  "new_paid_conversions_7d": 11,
  "as_of": "2026-05-09T14:32:07Z",
  "cache_age_seconds": 412
}
```

Cache is per-metric, 15-min TTL, populated lazily. A single request that finds all six expired calls Stripe in parallel via `Promise.all`. If any one metric throws, return the others with `null` for the failed ones plus a top-level `errors: [{metric, message}]`. Never 500 the whole endpoint over one slow Stripe call.

## Auth

Identical to v1: `RequireOpsAccess` middleware, returns 404 for any email other than `alexander@alemayhu.com`. No change.

## Frontend

**Tab placement:** inline tabs directly under the `Ops` h1, above the existing window selector / refresh row. Two tabs only: `Engineering` (active on `/ops`) and `Business` (active on `/ops/business`). Reuse the existing `.surface` border treatment as the tab bar's bottom border so it merges with the panel grid below.

**Routing:** in `App.tsx`, register `/ops/business` as a sibling lazy route. Both routes render a shared `OpsLayout` (h1 + tabs + outlet); the existing chart grid moves into an `EngineeringTab` component, the new view goes in `BusinessTab`. Tabs are `<Link>`s, not state — path-based, reload-safe, screenshot-shareable.

**Card shape:** single big number per card. No sparklines, no trend arrows in v2 — without persisted history we'd be faking deltas, and a fake delta is worse than no delta. Each card is one `.surface` panel:

```
+--------------------------------+
| MRR                            |   <- panel title, --text-base, semibold
| $4,820                         |   <- big number, --text-3xl, mono, primary
| as of 14:32 (cache 7m old)     |   <- footnote, --text-xs, tertiary
+--------------------------------+
```

Six cards in a 3x2 grid on desktop (`repeat(3, 1fr)`), 2x3 on tablet, 1x6 on mobile. Same 1rem gap as the engineering grid. Designer owns final number formatting (`$4,820` vs `$4.8K`, percent precision, etc.) — set the shape, not the typography.

The six cards in render order (left-to-right, top-to-bottom): MRR, Net new MRR MTD, Active paying subs, Churn 30d, Failed payments 7d, New paid conversions 7d. Money first, health second, hygiene third — matches how Al would scan it.

Auto-refresh: same 30s interval as Engineering, but the server cache is 15 min, so most refreshes will return identical data. The footnote `cache Xm old` makes that visible without surprising anyone.

## Out of scope (next iteration)

Per-customer drill-down. Refund tracking. Cohort analysis. LTV / ARPU. Sparklines and trend arrows (need persisted history first). Stripe webhooks (poll-on-demand is fine at our volume). Historical Postgres snapshots. Alerting. A "Design" tab (qualitative feedback doesn't aggregate). Multi-currency.

## Rollout: split into two PRs, in this order

1. **PR A — backend + tab scaffolding.** New endpoint, `StripeMetricsService`, `RequireOpsAccess` reuse, `OpsLayout` + tabs, `BusinessTab` renders raw JSON in a `<pre>` for sanity. Ships behind the existing email gate; nobody else sees it. Lets Al verify Stripe numbers match the real dashboard before any visual work.
2. **PR B — card grid.** Replace the `<pre>` with the six-card grid. Pure frontend change, no API churn.

Splitting catches Stripe-shape surprises (especially MRR computation, which has edge cases around discounts and trials) before the visual layer obscures them. PR A is the risky one; PR B is cosmetic.

## Open questions

1. **MRR definition** — sum `items[].price.unit_amount × quantity` across `status='active'` subs, normalize per-item by `recurring.interval` (yearly→/12, weekly→×4.33, daily→×30). Reconcile against Stripe's dashboard MRR in PR A. If >2% drift, revisit before PR B.
2. **Trial subs** — `status='trialing'` is excluded by querying `status='active'` only. "Paying" means a charge has cleared.
3. **Currency** — Stripe account is USD-only today. If we ever add a second currency, this design breaks; flag now so we don't ship multi-currency support reactively.
