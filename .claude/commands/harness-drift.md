---
description: Continuous-drift sweep — arch warnings and dead code outside the PR lifecycle
allowed-tools: Bash, Read, Grep, Glob, Task
---

The change-lifecycle sensors (`/check`, the pre-push hooks, CI) only see a diff. Some kinds of decay accumulate *between* diffs and no single PR is responsible for them: dead code, slow growth of circular dependencies, dropping test coverage, dependency rot. This command is the health sensor for that drift — run it on a schedule (e.g. weekly via `/schedule` or `/loop`), not per-change.

It does not fix anything. It produces a short report of what is decaying and hands the highest-impact item back for a decision.

## Steps

1. **Architecture drift.** Run the dependency-cruiser sensor and capture the warning counts (these are non-blocking in CI, so they grow unnoticed):
   ```bash
   pnpm --filter notion2anki-server arch 2>&1 | tail -3
   ```
   Compare the circular-dependency and data-layer-leaf counts against the baseline recorded in `.dependency-cruiser.cjs` (measured 2026-06-18: 27 cycles, data_layer/index.ts barrel). Report any increase — a rising count means new code is adding to the debt the warns were meant to freeze.

2. **Dead code.** Spawn the `dead-code-auditor` agent (read-only) over `src/` and `web/src/`. Report its top unreferenced exports / unreachable branches.

3. **Synthesize.** One report:
   - the single biggest drift since the last sweep (the headline)
   - the arch warning deltas
   - the top 3 dead-code candidates

End with one recommended action — the one cleanup worth a PR this week — not a backlog. If nothing drifted, say "no drift" and stop; a quiet sweep is a valid result.
