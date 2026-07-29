# Card size governs comprehensive AI conversions

## Problem

A paying user ran comprehensive mode on a 40-page PDF and left a rating-1 feedback: "The cards content are too small, making the number of cards too large." The mode produced 573 cards clamped silently to 500, averaging 84–133 characters per answer. Trio review (pm/designer/engineer, 2026-07-28) found three defects:

1. `cardSize` is plumbed into every floor-v1 chunk call but is structurally overpowered: the SYSTEM_PROMPT's min-info and density blocks never defer to it, and `buildTopUpInstruction` hardcodes "Extract MORE single-fact cards", contradicting `detailed` in the same prompt.
2. `FLOOR_V1_CARD_FLOOR=200` / `CEILING=500` are flat constants — a `detailed` run undershoots the floor and triggers top-up rounds that re-inflate the deck with micro-cards.
3. The 500-card ceiling clamp is invisible: no log line, and `ai_conversion_completed.card_count` records the post-clamp value.

Comprehensive mode's copy also promises the failure ("hundreds of cards per chapter instead of dozens") — it sells card count where the value is coverage.

## Change (locked set)

**Server — `src/lib/claude/ClaudeService.ts` + `cardSize.ts`:**

1. `resolveFloorV1Bounds(cardSize)` replaces the two flat constants: `short → {floor: 200, ceiling: 500}` (today's behavior), `medium → {floor: 150, ceiling: 400}`, `detailed → {floor: 80, ceiling: 250}`. Input normalized via `validateCardSize`. Used in the top-up `while` condition and the ceiling clamp.
2. `buildTopUpInstruction(existingFronts, cardSize)`: for `detailed`, the lead sentence becomes "Extract MORE cards from the same content, keeping 3-4 related facts per card." — `short`/`medium` keep the current "single-fact" wording.
3. SYSTEM_PROMPT: append to the min-info deferral line: "The Card size directive in the user message overrides these rules the same way." Add one line to the density block: "The Card size directive sets how much belongs on each card; when density and card size conflict, prefer fuller cards over more cards."
4. Ceiling clamp observability: log `[Claude] floor v1 ceiling clamp { preClampCount, ceiling }` and add `clamped_from` to the `ai_conversion_completed` props only when a clamp occurred.

**Web copy (designer-locked strings):**

5. `supportedOptions.ts` `ai-comprehensive` description → "Reads every section of long documents so nothing important gets skipped. Best for thorough study of dense material. Takes longer to make. Paid plans only."
6. Conditional hint in `CardOptionsForm.tsx`, rendered under the comprehensive checkbox only when checked: "On a long document this can make a large deck. For fewer, fuller cards, set Card size to Detailed." — "Card size" links to `#card-size`. New i18n key in all 10 locales.
7. Card size intro → "Controls how much AI puts on each card. Bigger cards mean fewer cards from the same material." Detailed description → "3-4 facts per card, ~320 characters. Fewer, fuller cards — good for concepts you want to review together." All 10 locales, same `{{placeholders}}` (none).

## Verification gate

Unit tests lock the bounds table, the top-up wording switch, the clamp log/prop, and the prompt deferral text. If a local Anthropic key is available, run a one-shot synthetic comparison (dense multi-chunk HTML through comprehensive at `medium` vs `detailed`) and record counts in the PR body; medium should land materially below today's output with detailed lower still. If counts do not separate, stop and re-open the trio question — ship only the copy half.

## What NOT to build

- No user-facing clamp notice, no card-count slider, no merged comprehensive+size control, no post-conversion re-convert prompt, no usage caps (pricing question, deferred to weekly retro).

## Metric

Emoji-widget rating on `downloads/deck_done` for comprehensive conversions, plus the `card_count` distribution and new `clamped_from` incidence in `ai_conversion_completed` — read at comprehensive mode's T+30d adoption review. Cost side: output-token share of the AI converter in the `[claude-usage]` aggregate should drop.
