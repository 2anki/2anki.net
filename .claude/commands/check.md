---
description: Parallel server tsc + server arch + web typecheck + web vitest + web lint
allowed-tools: Bash
---

Run all checks in parallel via a single Bash call:

```bash
bash scripts/check.sh
```

It runs `pnpm typecheck`, `pnpm arch`, and the web `typecheck`, `test:run` and `lint` in parallel, waits on each, prints `check: FAILED, pnpm <leg>` for every leg that fails, and exits non-zero if any did. Trust the exit code: a bare `wait` used to return 0 whatever the legs did (#5070).

The server leg is `typecheck` (`tsc -p . --noEmit`), never `build`. `build` is `tsc -p .` with no `outDir`, so it emits `.js` beside every `.ts`; TS module resolution then prefers the stale sibling and the cruise loses about 90% of its edges. `arch` runs `git clean -fX src` first to protect against that, but a `build` running *concurrently* re-emits during the cruise and blinds the `error`-severity rules this command exists to enforce. Same program, same errors, no emit.

`arch` is the dependency-cruiser architecture-fitness sensor (`.dependency-cruiser.cjs`). It exits non-zero on `error`-severity rules (a value-import of the knex query builder outside `src/data_layer/`, and `src/server.ts` reaching the conversion internals), and `scripts/arch.sh` also fails a run that cruised 0 modules, printed no module count or found no TypeScript compiler it supports, and stops before the cruise when `git clean` fails. Circular-dependency, data-layer-leaf, and layer-skip (route/controller reaching `data_layer` directly) violations ride as `warn` (reported, non-blocking) — they document existing debt that should shrink, not grow.

If any fails, print one line per failure with the file:line and the error message — nothing else. If all pass, say "all clean" and stop.

The web `lint` step runs oxlint with four rules worth keeping on their own merit (`typescript/prefer-optional-chain`, `no-nested-ternary`, `unicorn/no-negated-condition`, `no-unneeded-ternary`). Catching them locally avoids a CI round-trip.
