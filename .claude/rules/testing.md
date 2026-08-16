# Testing rules

Jest + ts-jest, `*.test.ts(x)` colocated next to source. `pnpm test <path>` to scope to a single file. Outside-in by default — exercise the use case from the route or controller boundary, not the leaves.

| Requirement | Do instead | CWE |
| --- | --- | --- |
| Do not mock internal services, repositories, or use cases just to make a test "easier". | Mock only at the external edge: HTTP (`axios`, `fetch`), Notion/Claude/Stripe SDKs, SendGrid, AWS, the filesystem when slow. Internal collaborators run for real. | — |
| Do not write a test that asserts only "did not throw". | Assert observable output: returned value, repository state, response body, side-effect call args. | — |
| Do not use `expect(...).toBeTruthy()` / `toBeFalsy()` on values that have a real shape. | Match the value: `toEqual({ ... })`, `toBe(0)`, `toMatchObject({ ... })`. Truthy/falsy hide regressions to neighbouring states. | CWE-754 |
| Do not commit `.only` / unconditional `.skip` / `xit` / `xdescribe`. The env-gated integration idiom `(RUN_INTEGRATION ? describe : describe.skip)` is the sanctioned exception (it is how NOTION_KEY-gated suites work). | Re-enable before commit; the suite is the contract. Use `--testNamePattern` while iterating. | — |
| Do not assert on the literal `Error.message` text from third-party libs. | Assert on the error class or your own coded error. Library messages drift between versions. | — |
| Do not write a test that depends on wall-clock time, current date, or `Math.random`. | Inject a clock/seed; use `jest.useFakeTimers()` and `jest.setSystemTime()`. | CWE-330 |
| Do not skip the failing-test step when fixing a bug. | Reproduce the bug as a failing test first, watch it fail for the right reason, then fix. | — |
| Do not call out to the network from a test (Notion, Stripe, Anthropic, Patreon, AWS). | Stub the SDK or `axios` at the module boundary; gate any genuine integration test behind `process.env.NOTION_KEY` like CI does. | — |
| Do not write a single test that asserts five unrelated things. | One behaviour per `it`; share setup via `beforeEach` or a builder. | — |
| Do not delete a test to make CI green. | Either fix the underlying code or, if the test was wrong, replace it with one that covers the real contract — explain in the commit body. | — |
| Do not add a new public function/route/use case without a test in the same PR. | The Stop hook flags untested new sources; add the `*.test.ts` next to it. | — |
| Do not assert on JSON snapshot blobs that include timestamps, IDs, or ordering. | Match shape with `toMatchObject` or normalize before snapshotting. | — |
| Do not write tests that share mutable module state across files. | Reset registries/singletons in `beforeEach`; prefer dependency injection over module-level state. | CWE-362 |
| Do not "cover" a repository method that builds raw SQL (`knex.raw`, `groupByRaw`, `countDistinct(raw(...))`) only through mocked-repo tests. They never execute SQL, so invalid SQL ships green and 500s in prod (e.g. an alias placed inside `count(distinct … as x)` — see the pricing A/B funnel incident). | Add a test that asserts on the **generated SQL**: build the query with a real Postgres-dialect knex (`knex({ client: 'pg' })`, no connection), capture `qb.toString()`, and assert the SQL shape. A sqlite integration test can't substitute — it won't reproduce PG-only syntax (`::text`, `props->>`). | CWE-89 |
| Do not report a branch green off **targeted** suite runs after touching shared parser/multi-consumer code (`DeckParser`, `BlockHandler`, `Note`, induction helpers, exporters). The regression lives in a distant suite the targeted run skipped — the #3908 cloze mangle passed every targeted suite locally and failed `DeckParser.test.ts` on CI. | Targeted runs are for iteration only. Run the FULL server suite + full web suite before every push; a "green" claim (yours or a subagent's) must state full-suite counts, excluding only the documented environmental failures (`getPageCount` pdfinfo; `PythonExitError` suites in worktrees without the venv). | — |

## Conventions

- Test file name: `<source>.test.ts` next to `<source>.ts` (already enforced by `jest.config.js` testMatch).
- Coverage is collected from `src/**`; `src/templates/**`, `src/migrations/**`, and `src/test/fixtures/**` are excluded — don't add logic there.
- For multi-case behaviour use `it.each([...])` rather than copy-pasted `it` blocks.
- When a test is slow because of real I/O, ask whether the I/O belongs in that layer at all.
