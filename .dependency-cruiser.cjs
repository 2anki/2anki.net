/**
 * Architecture-fitness sensor for src/.
 *
 * Turns the layering rules in .claude/rules/code-quality.md (until now prose
 * the agent could only be *told* to follow) into a computational check that
 * fires in `pnpm arch`, `/check`, and CI.
 *
 * Severity is calibrated against the code as it exists today:
 *   - `error`  — invariants that are clean now; a new violation fails the build.
 *   - `warn`   — real existing debt; surfaced (with a count) so it stops growing
 *                silently, but does not block until it is paid down. dependency-cruiser
 *                exits non-zero only on `error`, so warns report without breaking CI.
 *
 * Measured on 2026-06-18 (branch chore/harness-engineering-controls):
 *   knex value-import outside data_layer: 0 (conversionPool — allowlisted infra)
 *   circular dependencies:                27 (mostly hubbed on data_layer/index.ts)
 *   data_layer importing upward:          2  (data_layer/index.ts wiring barrel)
 *   routes/controllers -> data_layer:     329 import edges (warn — debt frozen,
 *     not blocked; new code should go through a use case or service).
 */
module.exports = {
  forbidden: [
    {
      name: 'no-knex-value-outside-datalayer',
      comment:
        'Only the data layer may import the knex query builder as a value. Elsewhere, take a repository in the constructor (testable, no SQL leakage). `import type { Knex }` for typing a constructor param is allowed everywhere.',
      severity: 'error',
      from: {
        pathNot: [
          '^src/data_layer',
          '^src/KnexConfig\\.ts$',
          '^src/lib/conversionPool\\.ts$',
          '^src/seeds',
          '^src/migrations',
        ],
      },
      to: {
        path: 'node_modules/knex',
        dependencyTypesNot: ['type-only'],
      },
    },
    {
      name: 'no-circular',
      comment:
        'Circular dependency between modules. Break the cycle — extract the shared piece or invert one direction. 27 existing cycles cluster on the data_layer/index.ts barrel; surfaced as warn so the count cannot grow unnoticed.',
      severity: 'warn',
      from: {},
      to: { circular: true },
    },
    {
      name: 'data-layer-is-leaf',
      comment:
        'The data layer is a leaf: it must not import routes, controllers, or use cases. The data_layer/index.ts wiring barrel is the source of most of the circular dependencies above. New repositories must not add to it.',
      severity: 'warn',
      from: { path: '^src/data_layer' },
      to: { path: '^src/(routes|controllers|usecases)' },
    },
    {
      name: 'no-layer-skip-to-data-layer',
      comment:
        'Route -> controller -> use case -> service -> data layer. Routes and controllers should not reach into data_layer directly. Baseline 2026-08-17: 329 skip edges (warn — debt frozen; new code goes through a use case or service instead of growing it). The count is only honest when no stale compiled .js sits in src/ — the arch script purges them first; a run reporting ~36 means the purge was skipped and the cruiser resolved .js siblings instead of the .ts sources.',
      severity: 'warn',
      from: { path: '^src/(routes|controllers)' },
      to: { path: '^src/data_layer' },
    },
  ],
  options: {
    tsPreCompilationDeps: true,
    tsConfig: { fileName: 'tsconfig.json' },
    doNotFollow: { path: 'node_modules' },
    // `\\.js$` keeps the cruise on TypeScript only. In-place `pnpm build`
    // output (there is no outDir; prod runs src/server.js) leaves compiled .js
    // beside every .ts locally, and TS module resolution then prefers the
    // stale .js sibling — silently dropping ~90% of edges and blinding every
    // rule (the 2026-08-17 audit saw 36 reported vs 329 real skip edges). The
    // `arch` script runs `git clean -fX src` first so local cruises match CI,
    // which never emits .js (typecheck is --noEmit).
    exclude: { path: '\\.test\\.ts$|\\.js$|/test/|/__mocks__/|/migrations/' },
  },
};
