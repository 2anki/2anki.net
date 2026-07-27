# Spec: card rule induction as an empty-deck fallback

**Status:** draft
**Author:** Alexander (with Claude)
**Date:** 2026-07-27

## Problem

When a conversion produces zero cards we tell the user the deck is empty and stop. In the last 30 days that happened **227 times to 55 distinct users** — 157 on the upload path, 70 on Notion — out of 14,092 attempts.

The message we show is Notion-specific:

> No cards in this deck yet. 2anki makes a card from every Notion toggle — the toggle title becomes the question, what's inside becomes the answer. Wrap your key terms in toggles, then convert again.

157 of those 227 failures were people uploading a Word, PDF, or Markdown file who never touched Notion. We are telling them to go use a Notion feature.

The deeper issue: `ParserRules.FLASHCARD` is hardcoded to `['toggle']`. A document whose structure carries meaning in headings, bullets, table columns, or numbered lists produces nothing, even when its content is perfectly good study material. A fix shipped 2026-07-23 (#3816) added a toggle-less fallback for the Notion path, but it only reads top-level `rich_text`, never recurses into children, and failures continued (07-23 17:58, 07-24, 07-25).

## What we are building

When — and only when — a conversion yields **zero cards**, re-run the existing `DeckParser` with different `ParserRules.FLASHCARD` block types, score each resulting deck, and ship the best one if it clears a quality floor. If nothing clears the floor, fail with an honest, path-appropriate message.

Fallback-only scope is deliberate: the induction can never touch a conversion that currently works, so there is no regression surface.

### Candidate rules

| Candidate | `FLASHCARD` types | Rescues |
| --- | --- | --- |
| `heading` | `heading_2`, `heading_3` | lecture notes, structured study guides |
| `bullets` | `bulleted_list_item` | outline-style notes |
| `numbered` | `numbered_list_item` | enumerated lists, steps |
| `columns` | `column_list` | two-column term/definition layouts |
| `quote` | `quote` | quote-delimited Q&A |

`column_list` is already in `ParserRules.DECK_TYPE_ALLOWLIST`. `setFlashcardTypes()` already exists. No new parser is written — we drive the one we have.

### The scorer

Deterministic, no model calls. For a candidate deck of `n` cards over a source of `L` characters:

```
granularity = triangular(median(len(back)), lo=20, peak=P, hi=600)
coverage    = clamp(Σ(len(front)+len(back)) / L, 0, 1)   target band 0.3–0.95
balance     = 1 if median(len(front)) < median(len(back)) else decay
blankBack   = 1 − (cards with empty back / n)
dupFronts   = 1 − (duplicate fronts / n)
density     = fit(n, expected ≈ L / D)

score = 0.30·granularity + 0.20·coverage + 0.20·balance
      + 0.15·blankBack  + 0.10·dupFronts + 0.05·density

n == 0 → score = 0
```

`P` and `D` are **calibrated against the existing corpus of 914,041 cards**, not guessed. Ship blocked until those constants come from measured percentiles.

Floor: a rescued deck must clear `FLOOR` to ship. Below it, we fail honestly rather than hand a student cards we do not believe in. `FLOOR` is set from the corpus so that a clear majority of today's *successful* decks would pass it.

Ties break by candidate order (most conservative rule first), so the output is deterministic for a given input.

## Telemetry — the point of the exercise

Today deck **quality** is invisible. A conversion that yields 3 giant unusable cards is recorded as a success; 15,189 cards (1.7%) have shipped with a blank back and nothing flagged it. `parse_path_signatures` only counts `recognized` (12,275) vs `unclassified` (1,142) — no score, no per-rule breakdown, no trend.

New table `conversion_rule_scores`, one row per conversion:

| Column | Purpose |
| --- | --- |
| `id` | pk |
| `created_at` | trend over time |
| `source` | `upload` \| `notion` |
| `input_format` | `docx`, `pdf`, `md`, `csv`, `html`, `zip`, `notion` |
| `rule` | `toggle`, `heading`, `bullets`, `numbered`, `columns`, `quote` |
| `was_fallback` | did induction run |
| `score` | final composite |
| `card_count`, `doc_chars` | volume |
| `median_front_len`, `median_back_len`, `blank_back_rate`, `coverage` | the sub-signals |
| `outcome` | `shipped` \| `below_floor` |

**No filenames, no titles, no card text, no user content** — shape metrics only. `owner` is stored as a numeric id for correlation, consistent with `.claude/rules/support-confidentiality.md`.

Recorded on **every** conversion, not just fallbacks. Without the baseline we cannot say whether a rescued deck is better or worse than a normal one, which is the whole question. At ~14k conversions/month this is ~170k rows/year — trivial.

This makes three previously unanswerable questions answerable: is deck quality improving, which rule wins for which format, and how often does the toggle default silently underperform an alternative.

## Constraints

- **No UI changes.** Copy and deck-level output only.
- **No AI, no model calls.** AI is opt-in and gated at `PrepareDeck.ts:400`; sending a non-consenting user's document to a model is a consent violation, not a cost question. The fallback is fully deterministic and local.
- **No regression.** Induction runs only on the zero-card path.

## Sequencing

1. **PR 1 — scorer + telemetry.** Scorer as a pure function with unit tests, `conversion_rule_scores` migration + `pnpm kanel`, recording on every conversion. Ships alone and immediately starts answering "is quality improving." No behaviour change.
2. **PR 2 — induction fallback.** Wire candidates at the zero-card choke point(s), pick by score, honest failure below floor.
3. **PR 3 — copy.** Replace the Notion-toggle message with path-appropriate strings across 10 locales.

PR 1 first on purpose: it calibrates the constants PR 2 depends on with real data.

## Open questions

- **Choke points.** Where exactly is zero-card detected on the upload path and the Notion path? If there are two, both must be wired — the 2026-07-23 fix failed precisely because it reached only one path. *Engineer review pending.*
- **Re-parse safety.** Is `DeckParser` safe to run N times over one workspace, or does it mutate extracted files, write media, or carry state? This is the largest implementation risk. *Engineer review pending.*
- **Notion re-walk.** Can candidates re-run on retained blocks, or would each re-hit the Notion API (rate limits, latency)? *Engineer review pending.*
- **Signalling a rescue.** With no UI, do we mark a rescued deck at all (deck name, a note, silence)? *Designer review pending.*
- **Ship-vs-fail line.** Is a mediocre rescued deck better or worse than an honest failure for a student who trusts it? *PM review pending.*

## Success measure

- Empty-deck failures fall from 227/month toward zero; read from `conversion_failed` events with reason `empty_deck`.
- `conversion_rule_scores` shows the score distribution of rescued decks at or above the floor, and which rule wins per format.
- Day-7 check after PR 2: rescued decks are not disproportionately re-converted or abandoned versus normal decks.
