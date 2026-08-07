# Combine a multi-file upload into one deck

**Issues:** #3918 (primary), #3917 (within-upload duplicate case subsumed; cross-upload residual stays open)
**Trio:** pm + designer + engineer, 2026-07-31 (overnight). Decisions below are theirs; override freely.

## Problem

Our heaviest AI user (user 18996, ~46% of weekly AI usage) uploads several overlapping sources on one topic — book chapter, transcript, slides — and gets N parallel decks with near-duplicate cards. Today `worker.ts` runs one `PrepareDeck` per loose file, and the zip AI path converts per-HTML-file into separate subdecks. Sources never inform each other; overlap survives and every duplicate is re-billed.

## v1

When a local/Dropbox/Drive upload contains **2+ loose content files** (not a single zip — its subdeck nesting is loved and untouched), pause the auto-submit with the existing validation-interstitial pattern:

- Title: `One deck from {{count}} files?`
- Primary: `Make one deck` (emphasized default) · Tertiary link: `Keep them separate`
- No body copy in v1. Strings ship in all 10 locales (`upload.combine.*`, CLDR plurals for ru/pl).

`Make one deck` sends a per-request `combine=true` form field (never a persisted setting, never an env flag). Server keeps the existing **per-file `generateDeckInfo` calls unchanged and parallel**, then merges all files' cards into ONE deck under one name (first file's base name) and lets the existing `dedupeIdenticalCards` (normalized front+back, #3906) collapse exact cross-file duplicates. **No source concatenation, no sequential do-not-repeat preamble** — per-file-then-merge has zero input-token delta vs today and can only shrink output. With AI off, combine performs the same mechanical merge (one `.apkg` instead of N) — copy promises "one deck", not synthesis, so both engines are honest.

Combine mode switches the per-file fan-out to `allSettled` semantics: one failed file drops with a warning, the rest ship (mirrors the PDF-page and chunk salvage patterns). Success screen shows the normal single-deck state plus a muted `One deck from {{count}} files` caption via an `X-Combined-From-Count` header (same transport as `X-Card-Count`).

## Not building (v1)

- Sequential conversion with accumulated do-not-repeat fronts (costs more tokens than merge, serializes latency; near-dupe suppression deferred until exact-dupe data says it's insufficient).
- Any dedupe UI, diff/merge preview, or "merge with existing deck" picker.
- A recent-decks front index or any new table/migration; a sticky combine preference; changes to single-file or single-zip paths.
- #3917 cross-upload dedupe — revisit only if post-ship data still shows cross-session overlap; the feasible shape then is "extend this attached deck" (extract fronts via `ApkgPreviewService`, feed through a generalized `buildTopUpInstruction`).

## Analytics & lifecycle

- `upload_combine_prompt_shown`; `upload_combine_chosen` `{ choice: 'one_deck' | 'separate', file_count }` — added to BOTH allowlists (parity test). `conversion_succeeded` gains a `combined_from_files` prop on combined runs; no new completion event.
- Extension of the existing upload surface, not a new surface — no T+30 issue; day-7 prod check on combined-run success rate + cost per multi-file upload, folded into the weekly retro.
- **Kill condition:** Anthropic cost per multi-file upload must not exceed today's N-separate-decks cost (holds by construction; verify anyway). **Success:** `one_deck` chosen on most prompts; multi-deck batch results drop; top-decile AI-user repeat usage flat-to-up (`/api/ops/metrics`).

## Acceptance criteria

- [ ] 2+ loose content files + `combine=true` → one deck, one `.apkg`, deck name from the first file; exact cross-file front+back duplicates collapse via the #3906 normalization.
- [ ] Each file still converted by its own parallel `generateDeckInfo` call — no concatenation, input tokens unchanged vs separate conversion (assert call count + per-call payload in tests).
- [ ] One file failing (e.g. image-only) drops only that file; the combined deck ships with a warning naming the drop count.
- [ ] `Keep them separate` and single-file/zip uploads are bit-for-bit today's behavior.
- [ ] Events registered in both allowlists; interstitial + caption strings present in all 10 locales; changelog entry in the same PR.

## Touch list

`worker.ts` (route loose multi-file → single `PrepareDeck` when flagged), `PrepareDeck.ts` (merge + `allSettled` + name), `UploadService.ts` (field + header), `UploadForm.tsx` + `useFileValidation.ts` (interstitial), locales ×10, events ×2, tests (~5 server + 2 web). Risk MEDIUM (hot conversion path, off-path unchanged). No migration, no auth/payments — no worktree trigger.
