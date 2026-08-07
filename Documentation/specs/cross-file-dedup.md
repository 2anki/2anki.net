# Spec: Cross-file dedup for multi-file AI uploads (#3918, subsumes most of #3917)

### Trio synthesis
- PM: implicit cross-file dedup at generation time — sequential conversion threading accumulated do-not-repeat fronts; no toggle, keep sub-decks; subsumes the bulk of #3917.
- Designer: an opt-in "Combine into one deck" interstitial with full copy — but flagged themselves that a zip reads as ONE file client-side, so the interstitial can't fire on the dominant multi-file shape.
- Engineer: verified the code map — packaging is already one apkg with sub-decks on the Claude zip path; `buildTopUpInstruction`/`collectExistingFronts` exist (private, `ClaudeService.ts:993/983`) but are per-file today; ranked sequential+fronts as the right cost/quality point (~1.05–1.2× input tokens, ~N× wall-clock).
- Agreement: the defect is generation-time cross-file blindness, not packaging; the do-not-repeat mechanism is the right lever; raw concatenation is rejected.
- Conflict: toggle/interstitial (designer) vs no UI (pm). Resolved for v1 by the engineer's routing fact: the dominant multi-file case is a zip, where the client sees one file and no pre-submit choice is possible. v1 ships PM's implicit dedup with **no new UI**; the designer's combine-interstitial and true synthesis (summary-context) are recorded below as the explicit v2 candidate.
- Resulting plan: sequential per-file conversion inside the existing Claude branch, threading accumulated fronts via the existing top-up mechanism, plus a deterministic normalized front+back filter as backstop; measure via `ai_conversion_completed` props.

## Outcome

A single upload containing multiple content files with AI on stops emitting near-duplicate cards across its files. Success = ≥40% fewer normalized-duplicate front+back pairs on the overlapping-source shape (user 18996's workflow), with input tokens up ≤~10%.

## Goal alignment

Per-user-value + cost play on the account that is 46% of weekly AI usage, on the path that is ~88% of Anthropic spend. Metric: duplicate pairs suppressed (new prop) and `cost_usd` delta on `ai_conversion_completed`. Not an acquisition change — ships behind the week's acquisition-facing work per the allocation rule.

## Problem

`PrepareDeck`'s Claude branch (`PrepareDeck.ts:503-528`) runs one independent `generateDeckInfo` per HTML file (concurrency 3). Files never see each other, so a chapter PDF + transcript + slides on one topic yield the same fact as three near-duplicate cards in three sub-decks. Anki only dedupes byte-identical notes. Every overlap is re-converted and re-billed.

## Riskiest assumption

The model honors a do-not-repeat-fronts preamble across *differently-framed sources* as well as it does across chunks of one document. If not, we pay tokens and latency for no dedup.

**Smallest test to disprove** (offline, before shipping): run user 18996's shape (or synthetic chapter/transcript/slides) through (a) today's path and (b) sequential + accumulated fronts; count normalized duplicate pairs. Disprove if <40% reduction or >10% token growth. Runs directly against `generateDeckInfo`; no route, no UI.

## Scope

**In**
- Claude branch of `PrepareDeck.ts`: for ≥2 HTML/markdown content files, convert sequentially, threading the running front set into each subsequent call. Export/thread `buildTopUpInstruction` + `collectExistingFronts` (`ClaudeService.ts:993/983`, private today; used only inside `runFloorV1`).
- Deterministic backstop: normalized front+back filter across the merged output of the one upload (same normalization #3906 uses within a file).
- Keep per-file sub-deck names/prefixes. Packaging untouched (already one apkg — `getPackagesFromZip.ts:232`).
- Extend `ai_conversion_completed` with `source_file_count` and `cross_file_duplicates_suppressed` props (reuse the existing event; both KNOWN_EVENTS allowlists only if a new event name is added).
- Changelog: "Uploading several sources on one topic no longer produces duplicate cards across them".

**Out (deliberately)**
- Raw concatenation into one mega-prompt (chunking is stateless past 40k chars — `chunkHtmlByDetails`, `ClaudeService.ts:359`; synthesis wouldn't survive chunk boundaries).
- Merging into a single flat deck; any packaging change.
- A user-facing toggle or the designer's combine-interstitial (v2 below).
- #3917's cross-upload/over-time dedup (persisted index, post-hoc tool) — the residual case after this ships; revisit only if the signal survives.
- Non-AI parser path, Photo-to-Deck, single-file uploads (bit-for-bit unchanged).

## User story + acceptance criteria

As a heavy AI user uploading several overlapping sources at once, I want one clean set of cards, not the same fact worded three ways.

- [ ] ≥2 content files + AI on: cards whose normalized front+back appeared in an earlier file of the same upload are suppressed.
- [ ] Single-file AI uploads unchanged (output and token cost).
- [ ] Per-source sub-deck structure preserved.
- [ ] `ai_conversion_completed` carries `source_file_count` + `cross_file_duplicates_suppressed`.
- [ ] Input tokens ≤~110% of the independent-file baseline on the test shape.
- [ ] Full server suite green (shared Claude/parser core — no targeted-run sign-off).

## Leading indicator

Duplicate-card burden per multi-file conversion → tracked by the new suppressed-count prop; secondary: `cost_usd` per usable deck on multi-file conversions.

## Design notes (v2 candidate, not in this spec's build)

The designer's opt-in interstitial ("Combine these {{count}} files into one deck?" / primary "Combine into one deck" / secondary "Keep separate", with the too-large recovery "Convert separately instead") is the right surface **iff** we later build true synthesis (summary-context, engineer's option 2) for loose multi-file selections. It cannot serve the zip case (client sees one file). Copy preserved in the trio transcript; do not build it in v1.

## Technical pre-flight (engineer, verified)

- `generateDeckInfo` defined `ClaudeService.ts:1083`; `buildTopUpInstruction` `:993` (private, floor-v1 only today). Note: `ClaudeService.ts` contains non-UTF8 bytes — grep treats it as binary and silently skips; use `grep -a`.
- Multi-file reaches the Claude branch via zip → `getPackagesFromZip.ts:232` `buildClaudeFlashcardDeck` → one `PrepareDeck` → one apkg. Loose multi-file sync uploads also pass `req.files` through `GeneratePackagesUseCase` — confirm both entry points get the sequential path.
- Layers: `src/lib/claude/ClaudeService.ts`, `src/infrastracture/adapters/fileConversion/PrepareDeck.ts`. No routes/controllers/data-layer/migration.
- Latency: sequential drops concurrency-3 → ~N× wall-clock on multi-file AI uploads. v1 accepts this (heavy path is async job); if a realistic 5-file upload is unacceptable, the fallback is parallel convert + deterministic-filter-only (loses model-level dedup).
- Open: front-budget cap (80 fronts) across many files — start with existing cap, measure late-file dedup; composition with floor-v1's own intra-file top-up rounds (fronts must compose, not clobber); prompt caching does NOT apply across distinct file contents.
- Effort: M. Testing: SDK mocked at module edge; assert prompt shape (fronts from file 1 in file 2's prompt); PrepareDeck-level N-files test; full suite.

## Open questions

1. Sequential latency on 5+ file uploads — acceptable, or two-pass (parallel + deterministic filter only)? Recommend sequential unless measured unacceptable.
2. Front cap across files: keep 80, or scale by file count?
3. Should the deterministic backstop also run for non-comprehensive AI conversions (it is cheap and model-independent)? Recommend yes.
