# Browser attestation gate

Any PR that touches `web/src/` cannot be merged via `gh pr merge` unless the PR body carries one of two attestation forms. The gate is enforced by `.claude/hooks/check-browser-attestation.py`, which runs as a PreToolUse Bash hook alongside `check-merge-status.py`.

## When the gate fires

The hook intercepts every `gh pr merge <n>` command and fetches `gh pr view <n> --json author,body,files`. It fires — and blocks the merge — when:

- At least one file in the PR diff starts with `web/src/`, **and**
- The PR body does not satisfy the attestation (see below).

## What to write in the PR body

Add a `## Browser check` section to the PR body before merging. Tick both boxes after you've verified them:

```
## Browser check
- [x] Golden path on localhost:3000
- [x] No console errors at 375px
Notes:
```

Both checkboxes must be ticked (exact strings, case-sensitive). Unticked (`- [ ]`) or absent lines are treated as unverified.

## The out-clause

For PRs that touch `web/src/` but have no runtime-visible effect (pure type changes, dead-code deletion, internal constants), use the out-clause instead of the checkboxes:

```
Browser check: not applicable — <reason>
```

The line must start with `Browser check: not applicable —` (exact prefix, including the em-dash). The reason is free-form. Examples:

- `Browser check: not applicable — type-only change, no rendered output`
- `Browser check: not applicable — deletes an unreachable code path`

## Bypasses

The hook exits 0 (allow) without checking the body when:

- **Dependabot author** — `author.login == "dependabot[bot]"`.
- **Changelog-only diff** — every `web/src/` file in the diff lives under `web/src/pages/WhatsNewPage/changelog/`.
- **No `web/src/` files** — the diff contains no files under `web/src/`.
- **Tooling error** — `gh` is not on PATH, times out, or returns a non-zero exit code. The hook is fail-open to avoid blocking merges for tooling reasons unrelated to the spec.

## How the check works

`check-browser-attestation.py` is a PreToolUse Bash hook. It reads the `tool_input.command` from stdin (standard Claude hook protocol) and acts only on `gh pr merge` commands. When the command matches, it calls `gh pr view <n> --json author,body,files` synchronously and inspects the result. If the call fails for any reason, it allows the merge (fail-open). If the result is present and the body does not satisfy the attestation, it returns `permissionDecision: deny` with a diagnostic message listing both options.

The hook does not auto-write or modify the PR body. Attestation is honor-system — the gate confirms the words are there, not that the engineer ran the app.

## Machine-backed attestation — the golden-path spec

`web/tests/golden-path.spec.ts` turns the two checkboxes into a real run. It drives the golden path at a 375px viewport with the backend mocked at the network edge, and fails on any console error or uncaught page error — exactly what the checkboxes claim. Run it as the evidence behind the attestation:

```
pnpm --filter 2anki-web test:golden-path
```

A green run is the substance behind ticking `- [x] Golden path on localhost:3000` and `- [x] No console errors at 375px`. The spec is deterministic (every `/api/**` call is fulfilled from a fixture — no real Notion/Stripe/backend, no secrets), so it can be run locally or in CI.

### Decision: warn, not block (for now)

The spec is **not** wired into the merge gate; the hook stays **honor-system and fail-open** — a flaky e2e blocking every `web/src/` merge is worse than the gap it closes. Promote it to a blocker only after it runs green across several web PRs (start as a non-required CI job): then make it a required check, or teach `check-browser-attestation.py` to confirm a recorded pass. Until then it's a trusted run an engineer can point to. Do not change the hook's blocking behaviour or fail-open property when adding the spec.

## Connection to CLAUDE.md

CLAUDE.md already mandates "use the feature in a browser" before opening a PR. This gate makes that instruction machine-checkable at merge time. It does not replace the judgment call — it enforces the moment of confirmation.
