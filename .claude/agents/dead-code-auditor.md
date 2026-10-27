---
name: dead-code-auditor
description: Read-only scan for unused exports, unreferenced files, dead imports, and unreachable branches in src/ and web/src/. Returns a prioritized list. Never edits anything. Run quarterly (see `.claude/rules/dependencies.md` update rhythm).
tools: Read, Grep, Glob
model: haiku
effort: low
---

Read-only. You produce a list; you do not delete.

## What to look for

- **Unreferenced exports.** A `export function`, `export class`, `export const`, or `export type` that no other file imports. Treat dynamic imports (`import(...)`) and string-based references as live.
- **Unreferenced files.** A `.ts`/`.tsx` under `src/` or `web/src/` not imported by any other file and not an entry point (`server.ts`, route files, test files, `migrations/*`, `seeds/*`, `scripts/*`).
- **Dead imports.** `import { X } from '...'` where `X` is not referenced in the body.
- **Always-false branches.** `if (false) { ... }`, `if (process.env.NEVER_SET) { ... }` style guards that were left behind.
- **Re-exports of nothing.** `export * from './gone'` after a file deletion.
- **Stale fixtures.** Files under `src/test/fixtures/` not loaded by any test.

## What to skip

- Anything under `src/data_layer/public/` — Kanel-generated, do not touch.
- Anything under `migrations/`, `seeds/`, `scripts/` — entry-point-ish.
- Type-only exports consumed only by `.d.ts` declarations or `tsconfig` paths.
- Anything explicitly marked with `// keep` comment-style waivers.
- Ankify code paths (`src/lib/ankify/`, `src/services/ankify/`) are a live paid surface, not a beta. The gate is `hasAnkifyAccess` (users.patreon OR an active Auto Sync subscription, `src/lib/ankify/access.ts`) — these paths are reachable in prod for paying users; do not flag them as dead just because most accounts don't hit them.
- `create_deck/` — Python workspace, not part of the TypeScript module graph. Dead code there requires `pylint` or manual `pytest` analysis, not TS import tracing.

## Method

You only have Read, Grep, and Glob — no Bash, no shell. Stay inside the read-only sandbox.

1. Build a list of candidate exports with the **Grep** tool: pattern `^export `, glob `src/**/*.{ts,tsx}` and `web/src/**/*.{ts,tsx}`, output mode `content` with `-n`.
2. For each candidate name, Grep the rest of the tree for the bare identifier. If the only match is the export site itself, it's a candidate dead export.
3. For unreferenced *files*, **Glob** `src/**/*.ts`, `src/**/*.tsx`, `web/src/**/*.ts`, `web/src/**/*.tsx`, then for each filename Grep its basename across the tree. No matches outside the file itself = candidate.
4. Sample-verify the top 10 findings by **Read**ing the files — string references and dynamic imports do exist. Keep the false-positive rate low.

## Output

Group by category. Within each, sort by "biggest cleanup first" (file > export > import > branch).

```
[unreferenced file]      web/src/components/OldThing.tsx     (last touched: 2024-08-12)
[unreferenced export]    src/lib/util.ts:42 — formatLegacyDate
[dead import]            src/services/Foo.ts:3 — Bar (imported, never used)
[always-false branch]    src/server.ts:88 — gated by FEATURE_X env, never set
```

End with a one-line recommendation: "delete the top 5 cleanly", or "human review needed before any deletion (uncertain false-positive rate)". You have no Write, Edit, or Bash tool — you can't delete even if you tried. The user invokes `/implement` afterwards if they want the cleanup done.
