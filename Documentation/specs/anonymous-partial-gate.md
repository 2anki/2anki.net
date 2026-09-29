# Spec: Anonymous partial delivery v2 (account step before the download)

### Trio synthesis
- PM: build the first 21 cards, hold them, put the account step in front of the download; success is day-7 signup-start among treatment cap-hitters at or above control (40%) plus a claim rate.
- Designer: render the register form inline inside the drop zone at the moment the user expects a download button; the server must withhold the deck bytes, and the account must unlock more than the free 21 or it is a toll.
- Engineer: v1 streams the apkg and stores nothing; the existing spool route is owner-bound, so v2 needs a held-deck record and a claim endpoint (migration, hard rail); the `anon_id` cookie survives every signup path, so bind the hold to it rather than to a URL param the OAuth round-trip may drop.
- Agreement: withhold the deck server-side, release it only to an authenticated claimant, same flag and 50/50 split as v1, zip stays out.
- Conflict: reward size. The v1 funnel read (below) shows re-upload was not the leak, so the gate has to unlock something. Resolved: hold the source file, and on claim run the normal signed-in conversion for the new account (up to the free 100 cards a month, existing monthly-limit partial applies beyond). Claim carrier: `anon_id` cookie, server-side, no sessionStorage or URL dependency. Events: a distinct `anonymous_partial_gate_shown` so the v2 read never mixes with v1 rows.
- Resulting plan: treatment cap-hitters see "Your first 21 cards are ready" with the register form in the drop zone; signing up (any provider) or logging in claims the held file, converts it as that user, and lands them on the normal download state without re-uploading.

**Outcome**: Day-7 signup-start among treatment cap-hitters at or above control (40%), signup-complete at or above control (40%), and a claim rate (share of held files that get claimed) high enough that the build is not wasted: target 60% of completers, read from `anonymous_partial_claimed` over `anonymous_partial_gate_shown`.

**Goal alignment**: Simpler. One account step replaces "download 21, create an account, drop the file again", and the account is the funnel every pass and subscription runs through. Read from the events table by `arm` seven days after the /ops flip, same query shape as the v1 read on issue #4521.

**Problem**: v1 (PR #4520, live 2026-09-22 to 2026-09-29) handed over the first 21 cards and asked for an account in a notice under the download button. Cap-hitters: control 166, treatment 176. Signup started after the cap: 40% control, 23% treatment. People took the 21 cards and left, or came back signed out for another 21. The funnel of the 40 treatment users who did click the CTA: 40 started signup, 31 completed, 29 re-uploaded signed in. The re-upload step was not the leak. The leak is before the click: a notice under a working download button does not get read.

**Riskiest assumption**: That asking for the account before the reward converts at least as well as the wall, instead of reading as a bait and switch that sends people away with nothing. v1 proved the deck moment has pull (39 of 176 clicked to sign up, against 5 of 166 from the wall); v2 bets the pull survives being placed in front of the download.

**Smallest test**: There is no cheaper test than the experiment; the v1 funnel read above already ruled out the alternative explanation. Pre-registered rollback: day-7 treatment signup-start below control flips the flag off, same as v1.

**What this removes**: The v1 immediate download for treatment, the `AnonymousPartialNotice` under the button, the "drop the file again" instruction, and the signed-out loop of 21 free cards per visit.

**Primary action**: Create a free account to get the deck. Log in is the secondary path and must claim the same deck.

**Default behavior**: Flag off: today's limit wall for everyone. Flag on: 50/50 by hashed `anon_id`; control keeps the wall unchanged; treatment gets the gate. No user-facing toggle.

**Surface vocabulary**: The `/upload` drop zone states (`lockedPdf` is the precedent for "your file exists, one step unlocks it"), the existing `RegisterForm`, and the signed-in success state with `ConversionResult` and "Download deck".

**Scope**:
- In: treatment arm of signed-out single-file uploads over the 21-card cap; server holds the uploaded file plus a `held_decks` row; inline register form in the drop zone; claim endpoint that converts the held file as the claimant; expiry of unclaimed holds; events; copy in 10 locales.
- Out: zip uploads (#4522), changing the 21 cap, changing the wall for control, emails, any change to the arm split or the flag, the async AI conversion path (anonymous uploads never reach it).

**User story**: As a signed-out learner whose file made more than 21 cards, I want to create a free account and get my deck without uploading again, so the account step feels like the payoff rather than a toll.

**Acceptance criteria**:
- [ ] Treatment cap-hitter gets a JSON `{ kind: 'held', cardCount: 21, cardsHeldBack, totalCards }` response and no apkg bytes; the drop zone renders the gate state with the register form inline (OAuth grid first, then email); no download control is shown.
- [ ] Copy (English, `anonymousPartial` namespace, all v1 keys replaced): headline "Your first 21 cards are ready"; body "Create a free account to download them. Up to 100 cards a month, free."; context line "This file made {{total}} cards."; ready state "Your deck is ready" with the existing "Download deck"; expired state "This deck is no longer saved" / "We only keep unclaimed decks for a day. Drop the file again to remake it." / "Upload again". Region label "Create a free account to download your deck". Sentence case, no exclamation marks, no dashes.
- [ ] After signup or login through any provider, `/upload` claims the newest unclaimed hold for the request's `anon_id` cookie, converts the held file as the signed-in user (monthly limit and its partial notice apply as for any signed-in upload), records a normal `uploads` row, and renders the normal success state with the download available and the deck listed in Downloads. No re-upload.
- [ ] A different visitor cannot claim the hold: the claim endpoint requires authentication and matches the hold to the caller's `anon_id`; the storage key is never exposed to the client.
- [ ] Unclaimed holds expire after 24 hours; the held object lives under a reserved storage prefix so the dangling-object sweep leaves it alone, and the daily upload cleanup deletes expired holds and their objects. An expired claim renders the expired state, not an error.
- [ ] Control arm is byte-for-byte unchanged (`conversion_failed` reason `anonymous_cap` with `arm`).
- [ ] Events, added to both `web/src/lib/analytics/events.ts` and `src/types/AnalyticsEvents.ts` in the same PR: `anonymous_partial_gate_shown` (once per hold, with `cards_held_back` and `arm`), `anonymous_partial_claimed` (on a successful claim, with `arm`); `conversion_succeeded` at build keeps `card_limit_partial`, `cards_held_back`, `arm` and adds `held: true`. The inline register form must not fire `signup_started` on mount; it fires on first interaction so impressions do not pollute the funnel.
- [ ] Mobile at 375px: the gate stays inline in the drop zone; the register form gets an inline variant without its page and card wrappers so it inherits the zone padding.
- [ ] The flip PR opens a T+30 keep/remove issue with the review date in the title.

**Open questions**:
1. Claimed cards and the monthly counter: with the claim running as a normal signed-in conversion they count, which is right when the account gets the full deck. Confirm no double-count if the user also re-drops the file.
2. Whether to keep the URL `?claim=<key>` at all, or rely on the cookie alone. Recommendation: cookie only, fewer moving parts.
3. The `RegisterForm` inline variant: prop on the existing component versus a thin wrapper; engineer's call.

**Out of scope (next iteration)**: zip partial delivery; a signed-in "get the remaining cards" upsell on the claimed deck; a follow-up email to cap-hitters who signed up but never claimed.

## Design notes

- Placement: inside the drop zone, replacing the download state, in the neutral locked style (`dropZoneLocked`, lock icon), not the green success fill.
- Hierarchy: headline is the single hero; the ask is the body; the total is a muted context line. Do not lead with the held-back count; when the ask is an account, a loss frame depresses signup.
- The register form is the primary action. OAuth grid first, divider, email. Its footer log-in link and the account-exists recovery are the secondary path and must claim the same hold.
- Post-claim: show a short "Preparing your download" state before the ready state so the deck visibly arrives after the page reload.
- Accessibility: `role="region"` with the label above, plus a live-status announcement "Your 21 cards are ready. Create a free account to download them."
- Translation note for the native-speaker pass: "Up to 100 cards a month, free." leans on an English idiom.

## Technical pre-flight

- Where v1 lives: `src/services/UploadService.ts` treatment branch in `handleSyncUpload` (arm at about line 1471, single-package success block from about line 1611). The anonymous `downloadKey` is `null` there, so nothing is stored today.
- Hold: copy the uploaded file to storage under a reserved `held/` prefix (add to `RESERVED_KEY_PREFIXES` in `src/lib/storage/jobs/helpers/isDeletableBucketKey.ts`) and insert a `held_decks` row: `id`, `claim_key` (crypto random, unique), `storage_key`, `anon_id`, `filename`, `card_count`, `cards_held_back`, `created_at`, `expires_at`, `claimed_at`, `claimed_by`. Migration plus kanel regeneration in the same PR; `migrations/**` makes the PR a hard rail.
- Claim: `POST /api/upload/claim` in `src/routes/UploadRouter.ts` behind `RequireAuthentication`, new `ClaimHeldDeckUseCase`: newest unclaimed, unexpired hold for the caller's `anon_id`; fetch the held file; run the same conversion path a signed-in sync upload takes; stamp `claimed_at` and `claimed_by`; return the download key. 401 anonymous, 404 no hold, 410 expired or already claimed.
- Expiry: extend the daily `deleteOldUploads` pass to delete expired `held_decks` rows and their objects; no `src/server.ts` change.
- Client: `applyConversionSuccess` in `uploadResponse.ts` gains a `kind: 'held'` branch; `useUploadFormState.ts` gains zone state `heldForSignup`; `UploadForm.tsx` renders the gate and runs the claim on mount when signed in and a hold may exist (a cheap `GET` that returns 204 when there is none). `RegisterForm.tsx` gains the inline variant and the interaction-based `signup_started`.
- Async path: anonymous uploads never reach `performConversion.ts`; nothing to do there.
- Tests: Jest for the treatment response shape and the held row, claim use case status matrix, generated-SQL test for the repository, `isDeletableBucketKey` leaving `held/` alone; Vitest for the held branch, the gate render, claim-on-mount, and the events parity test. Full server and web suites before push.
- Effort: M, leaning L because of the migration cycle and the inline form refactor. Riskiest technical assumption: the `anon_id` cookie is present on the claim request after every provider's round-trip; verify with one OAuth provider on localhost before building the client.
