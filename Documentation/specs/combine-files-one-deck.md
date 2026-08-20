# Spec: Combine multiple uploaded files into one synthesized deck (#3918)

**Outcome**: A paid user who uploads several sources on one topic gets a single deck, not N overlapping decks. Success = ≥25% of multi-file AI uploads opt into combine within 30 days, with no rise in cost-per-card.
**Goal alignment**: Retention/per-user-value lever (the axis in CLAUDE.md). Read on `ai_conversion_completed.combine_mode` share and the day-1/day-2 `ai_usage_recorded` cost-per-card split; T+30d review issue.
**Problem**: The heaviest AI-converter user uploads a chapter + lecture transcript + slide deck on one topic and gets three separate decks. Cross-file dedup already suppresses overlap (#3971), so the residual pain is fragmentation: three decks to name, study, and manage instead of one, plus manual merging in Anki afterward.

**Riskiest assumption**: That multi-file AI uploads are common enough to justify a new upload-surface choice, and that a single merged deck beats N deduped decks for study. Overlap is *already* handled — so the only marginal value is "one deck to manage."
**Smallest test**: The data already exists. Query `ai_conversion_completed` where `source_file_count >= 2` over the last 30 days (shipped by #3971). If multi-file AI uploads run below ~5/week, this serves one user and should not ship a UI surface — file it as a note on the issue and stop. Run this before any engineering.

**What this removes**: The manual post-work of merging related decks in Anki, and the "why did I get three decks?" confusion. It adds one *per-upload* choice — justified because intent is genuinely unreadable from the file set (three files can mean "one synthesized deck" or "three chapters, three decks"), so no default can be right for both. It does **not** add a persistent setting.

**Primary action**: `/upload` — "Convert these files." Combine is a secondary packaging choice under that one action, shown only when ≥2 AI-content files are staged.
**Default behavior**: Separate decks (today's behavior — zero surprise, preserves the common batch-convert pattern). Combine is opt-in per upload. The unset default is the safe, expected outcome.
**Surface vocabulary**: `/upload` — reuse the existing staged-file-list vocabulary. No new pattern.

**Recommendation — approach (b), sequential conversion with accumulated do-not-repeat context.** The AI half is *already shipped* (#3971): multi-file uploads convert sequentially and thread the accumulated front set into each later file's prompt. The remaining work for #3918 is **packaging only** — merge the loose-file path's N `deckInfo` arrays into one deck, which the zip/Notion path (`buildClaudeDeck`) already does. Zero new Claude calls.

Token math, 3×20k-char sources (~5k tokens each, ~15k content):
- (a) concat: ~15k input, but the chunker splits it into independent Claude calls regardless, so cross-source "synthesis" is illusory and a chunk straddling source A's tail + B's head yields nonsense; provenance lost. ~1.0×, wrong output shape.
- **(b) sequential + accumulated fronts: ~15k content + ~1–2k fronts preamble ≈ 16–17k input, ~1.1× — and this is *today's* shipped cost. Combine adds ~0 on top.** ✅
- (c) summary→generate: ~15k to read+summarize + summary output billed at $15/M + ~3k to generate from summaries ≈ ~18k input, plus a full extra round-trip and detail loss (summaries discard the specific facts the heavy user wants). ~1.3× + quality regression. Reject.

**Cost envelope** (mandatory, per CLAUDE.md model-swap gotcha):
- `max_tokens` ceilings (`CHUNK_MAX_TOKENS` 32768), `CHUNK_SIZE`, retry/top-up loops: **all unchanged.** No new per-call budgets.
- Input-token multiplier vs today's multi-file behavior: **~1.0×.** Same files, same chunking, same call count — combine is a post-generation exporter merge (`buildClaudeDeck` flatMap), not a new inference.
- One honest risk: routing loose multi-file through a single combined build instead of the per-file loop must not change chunk count. Verify `chunks` on `ai_conversion_completed` is identical before/after.
- Scheduled reads (set at merge, not remembered later): day-1 AND day-2 `ai_usage_recorded` — cost/day, ceiling-hit rate, per-user split, and cost-per-card on multi-file uploads before vs after. Expect flat; investigate any rise.

**Gate**: `isPaying`. The Claude branch already requires `input.noLimits` (= `isPaying`) in `PrepareDeck`; combine is a packaging option on that path, so it inherits the same gate. Not `hasAnkifyAccess` — this is not an Ankify/Auto-Sync capability.

**Scope (request path: `routes` → upload `controllers` → `usecases/uploads/worker.ts` → `ClaudeService`)**:
- In: a `combine` flag on the upload request; when set and ≥2 files reach the Claude content path, route them through one combined `buildClaudeDeck` (the zip path's owns-dedup branch) instead of the per-file loop in `doGenerationWork`; merged deck uses the upload name, existing sub-deck names preserved. Jest: `worker.test.ts`, `PrepareDeck` tests. Vitest: the upload choice.
- Out: everything in "MVP excludes."

**User story**: As a paying user uploading several sources on one topic, I want to combine them into one deck so I study and manage a single deck instead of merging three by hand.

**Acceptance criteria** (copy passes VOICE.md — direct, sentence case, no exclamation marks):
- [ ] The combine choice appears on `/upload` only when 2 or more AI-content files are staged; default is separate decks.
- [ ] With combine on, a multi-file AI upload produces one deck named after the upload, with sub-deck names preserved and cross-file duplicates suppressed.
- [ ] With combine off, behavior is bit-for-bit unchanged from today.
- [ ] Non-AI files (Kindle, epub, mindmap, xlsx-non-AI) always keep their own deck, combine on or off.
- [ ] Claude call count and chunk count are identical whether combine is on or off.
- [ ] `ai_conversion_completed` carries `combine_mode: 'separate' | 'combined'`; the choice fires `combine_files_selected` (added to both `KNOWN_EVENTS` allowlists in the same PR).

**Open questions**:
1. Does the loose-file path deliver N apkgs as one zip download or N downloads today? Confirms whether combine changes download bundling or only deck structure.
2. Mixed upload (2 AI files + 1 Kindle) with combine on — one AI deck + one Kindle deck is the intended result; confirm the UI copy makes that clear.

**Out of scope (next iteration)**:
- True cross-source synthesis or summarization (approach c) — cards stay per-chunk; combine = shipped dedup + merged packaging.
- Topical-similarity auto-detection or a smarter default.
- Any persistent setting (this is a per-upload choice, not a Card option).
- Sub-deck re-titling, card re-ordering, de-interleaving by source, or re-generation to fill dedup gaps.
- Combine for the free/non-paying path (AI is `isPaying`-gated already).

**Surface lifecycle**: usage event `combine_files_selected` ships in the same PR; day-7 prod check; T+30d adoption-review issue created at merge with the review date in the title — verdict binary keep/remove.
