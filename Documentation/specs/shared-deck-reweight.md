# Shared-deck page reweight: make the acquisition CTA win

### Trio synthesis
- PM: measurement ships first (PR #4348); this spec is the follow-up that makes the measured loop convert — reweight the public page toward signups.
- Designer: the shipped page inverts the brief — Download is the hero and "Make your own" is buried under infinite scroll; fix hierarchy, cap the preview, fix consent timing in SharePopover, drop the red revoke.
- Engineer: web-only change, no migration, no new routes; consent-timing is a real flow change (create-on-click) with test updates, not a copy swap.
- Agreement: no in-file watermark, download stays ungated and one click, all strings in 10 locales.
- Conflict: preview cap could depress downloads — resolved: downloads are not the goal metric; `signup_origin='/shared-deck'` signups are, and Download remains visible in the sticky bar.
- Resulting plan: one `feat:` PR touching `SharedDeckPage` and `SharePopover` only.

## Outcome
Recipients of a shared deck link convert to creators. Raise share-page → `/upload` click-through (event `shared_deck_convert_clicked` ÷ `shared_deck_viewed`, shipped in #4348) and downstream `signup_origin='/shared-deck'` signups.

## Problem
The public share page (`/s/:token`) optimizes the wrong action. "Download deck" is the solid primary; "Make your own deck" is a muted outline below an infinite scroll of every card — on a 240-card deck the CTA may never enter the viewport. Separately, `SharePopover` creates a live public link the moment the popover opens (before the user reads the consent line) — a consent-timing bug that also creates orphaned public links.

## Riskiest assumption
A recipient who came for the file will tolerate the deck being demoted to secondary. Mitigation: Download stays one click, ungated, always visible in the sticky bar.

## Smallest test
Ship the reweight and read `shared_deck_convert_clicked / shared_deck_viewed` and `shared_deck_downloaded / shared_deck_viewed` at day-7 against the pre-change baseline PR #4348 starts collecting now. If convert-CTR does not move, revert the hierarchy (CSS-level change, cheap to undo).

## Scope
**In**
1. `SharedDeckPage`: invert hierarchy — solid primary `Make your own deck` → `/upload`; secondary outline `Download deck (.apkg)`.
2. Cap the preview at 8 cards; replace infinite scroll with a hard stop line: `Showing 8 of {{count}} cards`. Card count shown in the header.
3. Sticky bottom action bar (both CTAs always visible, any deck size). One value line under the primary CTA: `2anki turns your Notion pages, PDFs, and notes into Anki decks. Free to start.`
4. `SharePopover`: show the consent line first with an explicit `Create share link` button; call `createDeckShare` only on that click (today's auto-create-on-open effect goes away). Reuse of an existing active share keeps current behavior.
5. `Stop sharing` button: neutral styling, not `--color-danger` (revoking is routine and reversible, not destructive).
6. Create-link failure gets recovery: `Couldn't create the link. Try again.` + Try again button.
7. Every new/changed string in all 10 locales (`previews.json` namespace); changelog entry (user-visible).

**Out**
- Sharer display name on the page (privacy escalation — decided against in trio).
- Any change to the `.apkg` file, download gating, or rate limits.
- Public gallery / `is_public` columns (issue #4349).
- Typed revoked/deleted API statuses (today string-matched; separate cleanup).
- New share entry points (post-conversion success, deck-list rows) — next iteration, after CTR read.

## User story
A student opens a link their study group sent. They skim a taste of the deck, download it if they want it, and — because the page's strongest message is "you could make one of these from your own notes" — click through to `/upload`.

## Acceptance criteria
- [ ] `Make your own deck` is the solid primary; `Download deck` is secondary outline; both sit in a sticky bottom bar visible without scrolling on any deck size.
- [ ] Preview renders at most 8 cards with `Showing 8 of N cards`; no further fetching (`fetchNextPage` no longer wired to scroll).
- [ ] Opening `SharePopover` creates nothing; the consent line and `Create share link` button show first; the link exists only after the click; `share_link_created` still fires only on creation.
- [ ] `Stop sharing` is neutral-styled; confirm flow unchanged.
- [ ] Create failure shows the recovery copy with a working Try again.
- [ ] `shared_deck_viewed` / `shared_deck_downloaded` / `shared_deck_convert_clicked` keep firing (from #4348).
- [ ] All strings present in the 10 locale files; `pnpm --filter 2anki-web test` green.

## Metric
`shared_deck_convert_clicked ÷ shared_deck_viewed` (target: measurable lift over the #4348 baseline at day-7) and `signup_origin='/shared-deck'` signups (target ≥25 by day-30). Read at `/api/ops/metrics`.

## Design notes
- Header keeps wordmark + deck name + `Shared via 2anki`; add card count as a plain spec (`240 cards`) so `Showing 8 of 240` reads honest.
- The value line sits under the primary CTA in the sticky bar, small text.
- Empty/revoked/deleted states unchanged (already on-voice).

## Technical pre-flight
- Web-only: `web/src/pages/SharedDeckPage/SharedDeckPage.tsx` + `.module.css` + test, `web/src/pages/PreviewApkgPage/SharePopover.tsx` + `.module.css` + test, `web/src/lib/i18n/locales/*/previews.json` (10 files), changelog JSON.
- No server change, no migration, no new routes — `/s/:token` already in `knownRoutes.ts`.
- Preview cap: stop observing the sentinel and don't call `fetchNextPage`; first batch already returns ≥8 cards (verify batch size; if batch < 8, allow one fetch).
- Consent-timing: the popover's create-on-open `useEffect` becomes lookup-only (`getActiveSharesForUploadKey`); `createDeckShare` moves to the button handler. Update the two create-flow tests in `SharePopover.test.tsx` accordingly (they currently assert create fires after open).
- Effort: **S–M** — one PR, browser attestation required (visual change), `pnpm format:check` before push.

## Open questions
- Should the sticky bar collapse to stacked buttons under 375px, or shrink labels? (Designer default: stack, primary on top.)
- Batch size of `/api/shares/:token/cards` — if the first page returns fewer than 8, is one extra fetch acceptable? (Engineer default: yes.)
