# Conversion report — tell the user what happened to every block

Issue: #4211 · Trio spec 2026-08-22 · Status: awaiting `/implement`

## Problem

Users convert a page and the deck has fewer cards than expected, and nothing in the product reconciles the difference — "I converted a 40-page page and only got 12 cards, where did the rest go?" is the top converter support class. The signals exist (unsupported-block counts, dropped assets, empty backs, forbidden blocks, truncation, rejection reasons) but render as up to five separate stacked chips with single-winner logic, never as one accounting.

## What ships (v1)

One **Conversion report** entry per download row, replacing the stacked notice chips: a tertiary link plus a count pill when anything was skipped (`3 skipped`, `.badgeWarning`). Opens a **modal** (`useDialog`, focus-trapped, Escape closes) with:

- **Summary** — `34 cards created, from 52 blocks · 3 skipped` (tabular numerals; skipped count tints warning when > 0).
- **Skipped list** — one line per aggregated reason, each with a tone label (*Note* `.badge` / *Skipped* `.badgeWarning` / *Couldn't convert* `.badgeDanger`), the count, and the existing shipped notice copy with a concrete fix ("2 empty toggles — add a question in the toggle and the answer inside it, then convert again"). Labels are text, never color alone.
- **Rejected before conversion** — when the input never converted, the modal shows the exact rejection reason using the existing `jobFailureReason` strings.
- **Clean conversion** — link renders plain; body reads "Nothing was skipped — the whole page converted." No fanfare.

Copy reuses the shipped notice strings (`downloadsx.json`: emptyBack, imageDrop, unsupportedBlocks, blocksForbidden, structureRescued); net-new strings are only the summary and success lines, translated across all 10 locales.

**Path coverage in v1:** Notion conversions get the full per-block accounting. Upload conversions get the pre-conversion rejection reason when they fail (strings already exist); full upload-path accounting is the first fast-follow because `UploadService` writes no success signal today (returns synchronously) — resolved trio conflict, see PR body.

**NOT building:** per-block re-run, historical backfill (reports exist only for conversions after ship), report export/share/email, removing the old notice components in the same PR as the new surface (consolidation lands with the web PR, deletion of dead chip components after the day-7 check).

## Data model and plumbing

- `ALTER TABLE jobs ADD COLUMN conversion_report jsonb` + kanel regen (both `src/data_layer/public/Jobs.ts` and `web/src/schemas/public/Jobs.ts`) in the same PR — hard gate.
- Shape: `{ summary: { blocks_seen, cards_created, blocks_skipped }, entries: [{ stage, reason_code, human_reason, count }], truncated?, omitted_entry_count? }`. Stages: `precheck | block | media | card | output`. Reason codes reuse the existing signal codes plus `unsupported_block:<type>` detail.
- **Cap:** entries aggregate by `(reason_code, detail)`; `MAX_REPORT_ENTRIES = 50` distinct keys. Past the cap, existing counts keep incrementing, new keys stop, `truncated: true` + `omitted_entry_count` set. Caps the Map, not bytes.
- Assembly in one helper `buildConversionReport(bl, api, failureCode?)` called from `performConversion` where BlockHandler and the API wrapper are in hand; threaded through `CompleteJobUseCase` → `updateJobStatus`. One new counter in BlockHandler (`blocks_seen`); everything else already exists.
- **Race guard:** the report writes only on the `done` status write and must survive a racing `failed` write — repository test asserting done-then-failed leaves `conversion_report` intact.

## API

`GET /api/upload/jobs/:jobId/report` (RequireAuthentication), lazy-fetched on modal open — never bundled into the polled jobs list. Route → controller (`JobController.getJobReport`) → `JobService` → `JobRepository`; response mapped to a typed `ConversionReport`, never the raw row.

## Analytics, metric, lifecycle gates

- Event: `conversion_report_opened`, fired on modal open, props `{ source, blocks_skipped, has_precheck_reason }`. Added to **both** KNOWN_EVENTS allowlists in the same PR (parity test enforces).
- Primary metric: missing-cards support-theme volume down ≥30% at T+30 vs trailing 30d. Adoption gate: open-rate ≥15% of conversions, read at `/api/ops/metrics`.
- Day-7 prod check: event counting, buffer cap holds on a large page, no conversion error-rate spike. T+30 review issue created at merge — binary keep/kill: keep if open-rate ≥15% AND support theme trending down; kill if open-rate <5% or support volume flat.
- One-surface-in-flight rule applies.

## Execution — 3 PRs

1. **Write path** (riskiest): migration + kanel, `buildConversionReport` + cap tests, wiring, race-guard test.
2. **Read API**: route/controller/service/repository + typed mapping + tests.
3. **Web**: report modal replacing the chip stack, lazy fetch, i18n ×10, analytics event, changelog entry.
