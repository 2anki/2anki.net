---
name: revise-claude-md
description: Diff the session, propose targeted CLAUDE.md / FEATURE.md updates
allowed-tools: Read, Edit, Bash
---

Look at what actually changed this session and propose surgical updates to `CLAUDE.md` and any colocated `FEATURE.md`. Do not rewrite for style — only add load-bearing facts that will help the next cold session.

Process:

1. **Inventory the changes.**
   - `git diff --stat origin/main...HEAD` for the full picture.
   - `git diff origin/main...HEAD -- 'src/**'` for source.
   - `git status --porcelain` for uncommitted work.
2. **Identify drift.** For each meaningful change, ask:
   - Did a public surface, layering rule, or constraint shift? → CLAUDE.md or layer's CLAUDE.md.
   - Did a complex module (the ones with FEATURE.md) gain/lose responsibilities, change contracts, or pick up a new gotcha? → that FEATURE.md.
   - Was a new gotcha discovered (the kind a future you would want to know in cold context)? → CLAUDE.md "Gotchas" section.
   - Was a new external dep added that needs a wrapper? → `.claude/rules/dependencies.md` or a FEATURE.md for the new module.
3. **Propose edits as Edit calls.** Each edit must be small (≤ 6 lines). Do not propose any edit that just paraphrases the diff — only facts that aren't recoverable from the code itself.
4. **Respect the budget.** CLAUDE.md is capped at ~250 lines. If an addition would push it over, push the detail down into a FEATURE.md and import via `@path/to/FEATURE.md`, or demote a situational rule to load-on-demand (referenced by path under "Load on demand" rather than `@`-imported).
5. **Skip the obvious.** Don't document patterns the reader will see in five files. Don't write WHAT the code does — names cover that.

Output format: list each proposed edit as `path :: one-line rationale`, then the Edit calls. If nothing meaningful drifted, say "no doc updates needed" and stop.
