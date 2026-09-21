# Spec: Anonymous partial delivery (first 21 cards, then re-drop after signup)

### Trio synthesis
- PM: Right bet. Split with the DB feature flag. Day-7 primary metric is signup-start rate among cap-hitters; the pay-rate guardrail needs about six weeks. No new surface, so no T+30d review issue.
- Designer: Show a calm neutral notice next to the result with the 21-card download as the primary action and signup as the secondary. Never promise an instant unlock.
- Engineer: Feasible, size M. The anonymous path is synchronous, has no server-side copy of the deck, and builds the apkg before the cap check, so the cap must apply during generation. An unlock without re-upload needs new storage and a privacy review.
- Agreement: Deliver the first 21 cards instead of refusing; gate by a DB flag hashed on the anonymous id, default OFF; a delivered partial is a success, not a paywall failure; ceiling on abuse is unchanged.
- Conflict: The designer wanted the account to claim the converted deck after signup. Anonymous output is streamed once and never stored, so the promise is cut. Resolved with the re-drop flow the maintainer approved: sign up, then drop the file again. PM wanted no new event; the engineer proposed a new server event. Resolved by reusing `conversion_succeeded` with props, and adding only two client events for the notice.
- Resulting plan: Behind a flag, an anonymous upload over the cap returns a 21-card apkg plus a held-back count in a response header, the upload result shows a notice, and the copy says to sign up and drop the file again.

**Outcome**: More anonymous visitors who hit the cap start signup. Leading indicator: signup-start rate among cap-hitters, treatment vs control, read at day 7. Lagging guardrail: pay rate per cap-hit, read no earlier than about six weeks. Live numbers are not recorded here (CLAUDE.md keeps them out of the repo); the definitions are under Measurement.
**Goal alignment**: Faster (a deck arrives immediately instead of a dead-end redirect) and simpler (one fewer wall). Metric read in prod `events`, day 7 and week 6.
**Problem**: An anonymous visitor uploads a file, waits for conversion, and when the deck is over 21 cards is redirected to `/limit?kind=anonymous` with nothing to show for it. Signed-in free users over the monthly limit already get a partial deck. `conversion_failed` is dominated by this wall (reasons `anonymous_cap` and `monthly_limit`), not by parser failures.
**Riskiest assumption**: Showing 21 real cards raises signup instead of satisfying the visitor, especially when the deck is only slightly over 21 cards.
**Smallest test**: Ship behind the flag at a 50% split and compare arms at day 7. To make the "slightly over" case readable, both arms record a card-count bucket on the cap-hit event.
**What this removes**: The anonymous dead-end redirect. `/limit?kind=anonymous` stays only for the control arm until the experiment concludes, then its anonymous branch is deleted in a follow-up.
**Primary action**: Download the 21 cards (unchanged from any other conversion). Signup is the secondary action.
**Default behavior**: Flag OFF means today's behavior exactly. Flag ON delivers the partial deck to the treatment arm. Under or at 21 cards nothing changes.
**Surface vocabulary**: The upload result on `/upload` and `/`, plus the existing `MonthlyLimitPartialNotice` shape and `monthly_limit_partial` wording. No new component style.
**Scope**:
- In: sync anonymous path over the cap delivers the first 21 cards; response header with the held-back count; notice on the upload result; flag split; events; 10 locales; changelog entry.
- Out: any server-side storage of anonymous decks; an unlock after signup; changing the cap value; changing the signed-in monthly limit; a new `/limit` variant; env flags.
**User story**: As a visitor without an account, I want to download the first 21 cards of my deck right away so that I can see it works before I decide to sign up.
**Acceptance criteria**:
- [ ] Flag OFF: an anonymous upload over 21 cards behaves exactly as today (refused, redirect to `/limit?kind=anonymous`, `conversion_failed` reason `anonymous_cap`).
- [ ] Flag ON, treatment arm: the response is a 200 apkg containing exactly the first 21 cards in deck order, `X-Card-Count` is 21, `X-Cards-Held-Back` is the remainder, and both are in `Access-Control-Expose-Headers`.
- [ ] Exactly 21 cards or fewer: no held-back header, no notice, no behavior change in either arm.
- [ ] The treatment cap-hit is recorded as `conversion_succeeded` with `card_limit_partial: true`, `cards_held_back`, `arm`, and a card-count bucket. It is not recorded as `conversion_failed` and does not fire `paywall_shown`.
- [ ] The control arm's cap-hit carries the same `arm` and card-count bucket props, so the denominators match.
- [ ] The notice shows the held-back count, offers "create a free account", and says to drop the file again after signing up. It never says unlimited and never promises an instant unlock.
- [ ] Focus and announcement: the count is announced via `role="status"`; contrast passes AA in all 5 themes.
- [ ] All new strings exist in all 10 locales with matching placeholders and full plural forms.
- [ ] A user-visible changelog JSON ships in the same PR.
- [ ] Copy passes VOICE.md: direct, specific, sentence case, no exclamation marks, no dashes.
**Open questions**:
- Where exactly the worker applies the cap: pass a `cardLimit` in the generation payload so decks are truncated before export (preferred), or re-run generation with the limit when the first pass exceeds it (simpler, doubles parse time for over-cap anonymous uploads only). Decide at implement time after reading the worker.
- Which web component renders the notice. `uploadResponse.ts` already parses `X-Dropped-Assets` and `X-Empty-Back-Count`; the notice belongs beside that success state.
- Unverified: the sync path also runs `CheckMonthlyCardLimitUseCase` for signed-in owners and throws instead of truncating, while the job-queue path truncates. If signed-in users actually reach the sync path over the monthly limit, they get the same dead end. Check before implement; if true, it is a follow-up using the same mechanism.
**Out of scope (next iteration)**: Persisting anonymous output for a true unlock; removing the anonymous branch of `/limit`; the same partial delivery for the signed-in sync path.

## Design notes
- **Moment**: the visitor just finished converting and expects a deck. Keep them on the upload result; do not bounce to `/limit`.
- **Layout**: the finished result with the 21-card download first. Directly below, a neutral notice using the existing `.card` token (no red, no warning colour) holding the count and one signup button.
- **Copy** (final wording pending the VOICE.md pass; keep the digits, translate the words; take the 100 from the exported `FREE_MONTHLY_CARDS` constant, not a literal):
  - Headline: "Your first 21 cards are ready"
  - Body: "This file made {{total}} cards. You can download 21 now. A free account gets up to {{monthly}} cards a month: create one, then drop the file again."
  - Primary: the existing download action. Secondary button: "Create a free account"
- **Edge states**: exactly 21 = plain success; 22 = "1 more card" (i18next plural); a very large deck = real held-back count, never unlimited; a deck over the free monthly allowance = after signup the signed-in partial notice takes over, which matches this copy.
- **Signup return**: the CTA goes to `/register?source=` with the upload page as the return target, so the visitor lands ready to drop the file again.
- **A11y**: move focus to the result heading, announce the count politely, errors use `role="alert"`.

## Technical pre-flight
- **Verified in code**: the anonymous cap is thrown at `UploadService.ts` `handleSyncUpload` after `GeneratePackagesUseCase.execute` has already produced the packages and apkg in the workspace; `owner == null` means `downloadKey` is null and the bytes are sent once in the response body. Response metadata already travels in `X-*` headers (`X-Card-Count`, `X-Dropped-Assets`, `X-Empty-Back-Count`) exposed through `Access-Control-Expose-Headers`, so a new `X-Cards-Held-Back` header follows an existing pattern.
- **Layers**: services (`UploadService.ts`), usecases (`GeneratePackagesUseCase.ts` and its worker payload), lib/parser (`truncateDecksToCardLimit`, reusable as is), web (`uploadResponse.ts`, the notice, i18n), types (`AnalyticsEvents.ts` in both the server and web `KNOWN_EVENTS`). No route, controller or data-layer change, no migration.
- **Flag**: DB `feature_flags` via `getFeatureFlag` (5s cache, set from the Ops flags tab, emits `feature_flag_changed`). Decide the arm server-side by hashing the anonymous id; there is no public web flag endpoint and none is needed. No `process.env` flag.
- **Analytics**: reuse `conversion_succeeded` props for the server side. New client events `anonymous_partial_notice_shown` and `anonymous_partial_signup_clicked` go in both `KNOWN_EVENTS` lists in the same PR (`events.parity.test.ts` enforces it). Do not touch `PAYWALL_REASON_PATTERNS`; a delivered partial must not land in the paywall bucket.
- **Platform check**: no third-party service involved; nothing to verify against Stripe, SendGrid, Notion, AWS or Anthropic.
- **Abuse**: splitting files or clearing cookies already yields unlimited 21-card batches today. Delivering a partial instead of refusing does not raise the ceiling, only removes a friction point.
- **Hard rail**: expected. `CheckMonthlyCardLimitUseCase.ts` matches the limits path and signup copy may too. Plan for the review-agent verdict on a ready PR and the maintainer's manual merge.
- **Tests**: outside-in from the upload controller, mocking only the exporter and storage edge. Cases: flag OFF unchanged, flag ON over the cap (exact 21 cards, headers), exactly 21, and control-arm props. Web: header parsing, notice render, plural forms.
- **Effort**: M. The cost is threading the cap through generation on the sync path, not the UI.

## Measurement
Cap-hit denominator = distinct anonymous ids with an event carrying the `arm` prop (control: `conversion_failed` reason `anonymous_cap`; treatment: `conversion_succeeded` with `card_limit_partial`).
- Day 7 primary: share of those ids with a later `signup_started` on the same anonymous id, by arm.
- Week 6 guardrail: share that reach `checkout_completed`, by arm. Roll back if signup-start falls below control at day 7 or the pay rate trends below control.
- Cannibalisation cut: repeat both by card-count bucket, since decks just over 21 cards are where a partial nearly satisfies the visitor.
