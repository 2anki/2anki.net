---
description: Continuous-drift sweep — arch warnings and dead code outside the PR lifecycle
allowed-tools: Bash, Read, Grep, Glob, Task
---

The change-lifecycle sensors (`/check`, the pre-push hooks, CI) only see a diff. Some kinds of decay accumulate *between* diffs and no single PR is responsible for them: dead code, slow growth of circular dependencies, dropping test coverage, dependency rot. This command is the health sensor for that drift — run it on a schedule (e.g. weekly via `/schedule` or `/loop`), not per-change.

It does not fix anything. It produces a short report of what is decaying and hands the highest-impact item back for a decision.

## Steps

1. **Architecture drift.** Run the dependency-cruiser sensor and capture the warning counts (these are non-blocking in CI, so they grow unnoticed):
   ```bash
   pnpm arch 2>&1 | grep -oE '^ *warn [a-z-]+|arch: FAILED.*|[0-9]+ modules' | sort | uniq -c
   ```
   Compare each warn rule's count against the baseline recorded in `.dependency-cruiser.cjs` (measured 2026-10-28: 10 cycles, 1 data-layer-leaf). Report any increase — a rising count means new code is adding to the debt the warns were meant to freeze. No `modules` line, or an `arch: FAILED` line, means the sensor did not run: make that the headline, never "no drift". The grep shows only warns; an `error` rule fails CI on its own.

   Layer skips are no longer warns: `arch` ignores the edges in `.dependency-cruiser-known-violations.json` and fails on any other, so the grep above shows none of them and a count of 0 there says nothing about the debt. Read the remaining debt from the baselines instead:
   ```bash
   node -e 'console.log("layer skips", require("./.dependency-cruiser-known-violations.json").length); const b = require("./.debt-ratchet-baseline.json"); for (const k in b) console.log(k, Object.values(b[k]).reduce((s, n) => s + n, 0))'
   ```
   On 2026-11-24 they were 292 layer skips, 99 `console-log`, 0 `debugger`, 242 `explicit-any`, 5 `ts-ignore`, 12 `disable-directive`. The baselines can only shrink (CI fails new debt, and ceilings in `scripts/debt-ratchet/ratchet.test.ts` fail if a baseline file grows), so a smaller number means debt was paid down and the shrink was committed. An unchanged number means nothing was paid down, not that nothing was added: new debt cannot land at all. `pnpm arch` printing `stale known violations`, or `pnpm debt` printing "the baseline still allows", means debt was removed but nobody ran `pnpm arch:shrink` / `pnpm debt:shrink`; report that as the cleanup to commit.

2. **Dead code.** Spawn the `dead-code-auditor` agent (read-only) over `src/` and `web/src/`. Report its top unreferenced exports / unreachable branches.

3. **Synthesize.** One report:
   - the single biggest drift since the last sweep (the headline)
   - the arch warning deltas
   - the top 3 dead-code candidates

End with one recommended action — the one cleanup worth a PR this week — not a backlog. If nothing drifted, say "no drift" and stop; a quiet sweep is a valid result.
