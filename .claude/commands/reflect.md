---
description: Weekly reflection — what got simpler, faster, or more beautiful; what got worse; what we learned. One decision out, lessons land in repo docs, numbers stay in chat.
argument-hint: optional — days to look back (default 7)
allowed-tools: Bash, Read, Grep, Glob, Task
---

Use the `pm` agent for the answers and the decision; pull evidence yourself or via `conversion-funnel-analyst` / `support-triage`.

This replaces the metrics-first weekly retro (retired 2026-09-11 with the user-count and revenue targets). The goal in `CLAUDE.md` is qualitative — the go-to place on the web to create beautiful Anki flashcards, fast and easy — so the reflection reads evidence about the *experience* and about *how we work*, not a growth trajectory. There are no targets to compare against and no baseline block to write back.

## 1. Evidence — pull all four, in parallel where you can

1. **What shipped.** `gh pr list --repo 2anki/server --state merged --search "merged:>=<date>" --json number,title,labels,mergedAt`. Sort every PR into one bucket: simpler / faster / more beautiful / none of the three (process, deps, internal). The last bucket is fine — but if it is the majority, say so.
2. **What users felt.** The deck-feedback happy score and one-tap reasons (`/api/ops/business/metrics` → `happy_score`, `emoji_feedback_*`; or read-only prod psql on `events`), cancellation reasons last 14 days, GitHub issues opened by users this week, and any support `.eml` in `~/Downloads` (hand these to `support-triage`, read-only). Quote a user where a quote exists — one specific sentence beats a paraphrase.
3. **What broke.** Prod log tail via `/deploy-status`; reverts (`git log --since=<date> --grep=revert`); `fix:` PRs merged within 48 hours of the `feat:` they patch (rework — name the pair); failed deploy runs (`gh run list --workflow deploy.2anki.net.yml`).
4. **How we worked.** PRs that needed more than one CI cycle to go green (format bounces, red shards); hook denials that recurred; gotchas or rules added to `CLAUDE.md` / `.claude/rules/` this week; the `/harness-drift` headline if it ran. This is Claude reflecting on Claude — the harness is part of the product.

**Read production, never local dev, for anything numeric.** The prod psql recipe is in `Documentation/ops-observability/PROD_RUNBOOK.md`. If a source is unreachable, say so in the output — do not skip silently and do not guess.

## 2. Reflect — three questions, one line each, each with its evidence

- **Simpler, faster, or more beautiful:** what shipped this week that a first-time visitor dropping a file in would actually notice?
- **Worse:** what got slower, uglier, more confusing, or broke — per the happy-score reasons, the rework pairs, and the prod errors?
- **Learned:** what did we learn about how we work — a rule that fired usefully, a rule that is missing, a pattern that cost a CI cycle twice?

## 3. Decide — one thing for the next week

Not three. One. Either ship X, fix Y, or stop doing Z. Tie it to one of the three words in the goal.

## 4. Land the lessons in the repo, in the same session

Reflection that stays in chat evaporates. Anything durable becomes a docs PR before the session ends:

| Lesson shape | Where it lands |
|---|---|
| A trap that will bite the next agent | `CLAUDE.md` → Gotchas (one bullet, dated, with the why) |
| A hot-path behaviour worth knowing before editing | the matching `FEATURE.md` |
| A review finding that recurred | `.claude/rules/*.md` (one table row) |
| An outage or data incident | `Documentation/post-mortems/<yyyy-mm>-<slug>.md` |
| A stale doc the reflection tripped over | fix the doc |

Numbers never land in the repo — no baseline block, no metrics in commit bodies (`CLAUDE.md` → Memory & sensitive data). Reporter identity never lands anywhere public (`.claude/rules/support-confidentiality.md`).

## Output rules

- Chat output, two screens max. Evidence in short tables, answers in prose.
- Three answers + one decision + the list of doc changes landed (PR URLs). Nothing else.
- A quiet week is a valid result: "nothing got worse, nothing learned worth a rule" — say it and stop.
