# Stable card identity for upload decks

Issue: https://github.com/2anki/server/issues/4346. Drafted overnight 2026-09-10 by the trio; Alexander reviews the decisions flagged below before `/implement`.

### Trio synthesis

- PM: fix is a subtraction — drop deck name from upload-card identity and pin the rest in the existing `card_guids` ledger, signed-in only, deterministic formats only, no UI, no migration; gate the build on a data read of how often re-uploads actually happen.
- Designer: no UI in v1 (Anki's import dialog is the confirmation surface we do not own); two hard rules — fail toward a duplicate, never toward overwriting the wrong card; key on content, never on ordinal position.
- Engineer: today's upload guid is `guid_for(deckName, front, cardType)`, computed in Python; TS can override it by setting `card.guid`, so the ledger can own identity with zero Python change and no migration; AI/PDF decks regenerate fronts and must stay out of v1; ship a shadow-read metric in the same PR.
- Agreement: reuse `card_guids`, signed-in only, no UI, no migration, no Python change, full-suite plus adversarial review, AI and PDF out.
- Conflict: identity key. PM keyed on normalized front only (survives answer edits, the common case the designer wants); engineer keyed on front plus back fingerprint (safer against cross-deck collisions, but any edit re-keys — which fails the headline). Resolved: front-keyed identity with the ambiguity guard below, so answer edits update in place and the only case that cannot be told apart falls back to a safe duplicate.
- Resulting plan: for signed-in uploads of markdown, plain HTML/zip and CSV/xlsx, TS pins each card's guid in the per-owner ledger under a namespaced front-derived key, replays it on later uploads, and issues a fresh guid whenever a replay could land on the wrong card.

## Outcome

A signed-in user who edits an answer, adds cards, reorders, or renames a file they converted before gets an `.apkg` whose unchanged and answer-edited cards keep their guids, so Anki updates them in place and keeps scheduling. Goal axis: retention / per-user value. Metric: share of signed-in upload conversions that replay at least one stored identity (new server event `upload_identity_replayed` with `replayed`, `issued`, `guarded` counts), read at `/api/ops/metrics`; first read T+7, keep/adjust at T+30. Support threads about duplicate cards after re-upload trend to zero.

## Problem

A returning markdown/CSV user maintains a deck as a file. They fix an answer, rename the file, re-convert, re-import — and Anki adds a second copy of every card because the deck name sits inside the guid formula and the edited answer changes nothing that Anki could match on. Notion decks stopped doing this in https://github.com/2anki/server/pull/4255 (block-id ledger). Upload decks are structurally excluded: `pairSidecarWithCards` skips any card without a `notionId`, so they never reach the ledger.

## Riskiest assumption and the smallest test

Assumption: rename, reorder and answer edits (not question edits) are the bulk of real re-uploads. Smallest test: a zero-behaviour shadow read on signed-in uploads that logs how many of the upload's normalized fronts match the owner's prior fronts. Ship it in the same PR; if the T+14 read shows most re-uploads reword questions, v2 needs fuzzy matching or an explicit "update this deck" target and this v1 under-moves the metric.

## Scope

In v1:
- Signed-in uploads of markdown, plain (non-Notion) HTML and zip, CSV and xlsx.
- Identity key `u:` + `guidFor(normalizedFront, cardType)` where `normalizedFront` is `normalizeCardText` from `ClaudeService.ts` (strip HTML, lowercase, trim, collapse whitespace). The `u:` namespace keeps upload keys disjoint from Notion UUID `block_id` rows. **Locked vocabulary decision — flag in the PR `## Decisions`, never extend silently.**
- Guid value on first sight: `guidFor(owner, identityKey)` computed in TS and set on `card.guid`, which Python honours unconditionally. Deck name is no longer an input.
- Ledger row: `(owner, block_id = identityKey, guid, source_page_id = sourceKey, fingerprint = cardFingerprint(front, back))` where `sourceKey` is the normalized upload filename. Confirm the existing columns can carry the fingerprint; if not, this becomes a Tier 3 migration and the PR says so.
- Ambiguity guard (the designer's rule 1, made concrete): on a ledger hit, replay the stored guid when the back fingerprint matches (rename or reorder) or the sourceKey matches (answer edit in the same file). When both the filename and the answer changed, issue a fresh guid — a visible duplicate beats a silent overwrite of an unrelated card that happens to share a question. Two identical normalized fronts inside one upload get `#2`, `#3` ordinal suffixes on the key so they never collapse to one guid.
- Anonymous conversions: byte-identical to today.
- Tests (all TS, `DeckParser.stableGuids.test.ts` style): answer edit → same guid; rename → same guid; reorder → same guid; question edit → new guid (documented limitation, asserted, not claimed fixed); identical fronts in one deck → distinct guids; rename plus answer edit → fresh guid; anonymous → unchanged guids; Notion HTML upload still hits the block-id path.

Out (say why):
- Question-text edits: no anchor survives a reword; following it needs fuzzy matching, which can pin one card's history to another. v2, and only if the shadow read says it matters.
- PDF and AI/chat/MCP decks: Claude regenerates fronts on every cache miss, so no front-derived key is stable. `ai_card_fingerprints` already dedups them across decks; Anki identity for a non-deterministic engine is a separate problem.
- Any UI, toggle or "N updated" summary: we cannot see the user's collection; Anki's import dialog reports it. A dormant signed-out nudge ("Sign in before converting to keep your decks in sync") is a v2 experiment, not v1.
- Ordinal position as identity: reintroduces the bug one edit later.
- A new table or column when `card_guids` can carry the row.

## User story and acceptance criteria

As a returning uploader who keeps my deck in a file, I want to fix an answer, add a card, rename the file and re-convert, so that re-importing updates my existing cards in place and keeps my review history.

- [ ] Re-import after N answer edits: N notes updated, 0 added, scheduling intact.
- [ ] Re-import after a file rename: all notes updated in place, 0 duplicates.
- [ ] Re-import after adding M cards: exactly M added, the rest untouched.
- [ ] Re-import after a question edit: 1 note added, 0 overwritten.
- [ ] Two files sharing a question never overwrite each other's note.
- [ ] Anonymous conversions produce the same guids as before this change.
- [ ] `upload_identity_replayed` fires with counts on every signed-in upload.

## Technical pre-flight

- Layers: `services/UploadService` (`loadKnownGuids` / `recordIssuedGuids` already run on both sync and async paths), `lib/parser/DeckParser` (new replay-or-issue branch beside `applyLedgerGuids`, keyed on a new `card.identityKey` — do NOT reuse `card.notionId`, which also drives `guid_for(notionId)` in Python and the Notion link builder), `lib/parser/Note` (`identityKey?`), `lib/anki/collectIssuedGuids`, `data_layer/CardGuidLedgerRepository` (reuse; check column fit for the fingerprint).
- Python: none. Contract "Python honours `card.guid`" already exists and is tested in `create_deck/tests/test_stable_guids.py`.
- Migration: none expected. If the fingerprint needs a column, the PR becomes Tier 3 with kanel and `migration-reviewer`.
- Effort: M. Blast radius: high (every upload guid). Full server and web suites before every push; multi-agent adversarial review on the draft before `gh pr ready`.
- Open questions: (1) does the Notion HTML file-upload path already produce a ledger hit end to end, or only live sync; (2) column fit for the back fingerprint in `card_guids`; (3) exact `normalizedFront` rules for CSV cells with markup.

## Decisions for Alexander (override by editing this file before `/implement`)

- Identity key is the normalized front, not front plus back — chosen so answer edits update in place. Assumption: cross-file identical questions are rare and the ambiguity guard catches the rest.
- `u:` prefix in `card_guids.block_id` as the upload namespace.
- AI and PDF decks stay out of v1.
- Shadow-read metric ships in the same PR and decides v2.
