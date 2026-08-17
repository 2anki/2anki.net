# SonarCloud quality gate

## State as of 2026-07-30 — verified, not assumed

**There IS a quality gate and it evaluates per PR.** Verified on PR #3928 after the repo was re-onboarded to the `laer-smart` org on 2026-07-30 — the `sonarqubecloud` bot posts a "Quality Gate passed/failed" comment on the PR, and the API returns five conditions:

```
GET /api/qualitygates/project_status?projectKey=Laer-Smart_2anki.net&pullRequest=3928
  status: OK
  new_security_rating            GT 1    → A required
  new_reliability_rating         GT 1    → A required
  new_maintainability_rating     GT 1    → A required
  new_duplicated_lines_density   GT 3    → <= 3% on new code
  new_security_hotspots_reviewed LT 100  → 100% reviewed
```

**Query the right scope or you will read the wrong answer.** This is the trap that produced a wrong version of this very file hours earlier:

- `qualitygates/project_status?projectKey=…` with **no** `pullRequest` returns `{"status":"NONE","conditions":[],"periods":[]}` whenever `main` has not been analysed yet. That is *not* evidence the gate is absent — PR-scoped gate state lives only behind `&pullRequest=<n>`.
- `project_analyses/search?project=…` likewise lists **branch** analyses only. PR analyses appear in `project_pull_requests/list?project=…`, which is where the first post-onboarding analysis showed up while the branch list still read `total: 0`.

On 2026-07-30 the branch endpoints reported nothing while the PR endpoints reported a passing gate. Both were true simultaneously. **Check PR scope before concluding anything about the gate.**

**`main` may lag PR analysis after onboarding.** AutoScan seeds "the 5 most recently active Pull Requests" first; a `main` analysis needs a push to the default branch. The onboarding page can sit on "you should see this page refresh in a few moments" indefinitely if no such push has landed since it was enabled.

**Coverage on New Code reads 0.0% and that is expected.** Automatic Analysis runs no tests and uploads no lcov, so coverage is always 0 on the PR scan. The current gate has **no** coverage condition, which is why PRs still pass. If anyone adds a coverage-on-new-code condition in the UI, every PR will fail until coverage is uploaded from CI instead — do not add one without wiring that first.

**The org moved from `2anki` to `laer-smart`, which changed the project key.** The live project is `Laer-Smart_2anki.net`; the old `2anki_server` in org `2anki` kept auto-scanning `main` for weeks afterwards (34 analyses, most recent 2026-07-29), so the breakage was invisible — a stale project was quietly absorbing the scans, and PR decoration was silently absent the whole time. `sonar-project.properties` now points at the new key and `src/lib/sonarConfigParity.test.ts` asserts it. Disable AutoScan on the stale project (or delete it) so two projects stop scanning one repo.

Re-verify with `curl` before trusting any of this; it is a snapshot, and two successive snapshots of this block have already gone stale — one because nobody checked, one because the check used the wrong scope.

## Two configs, read by two different scanners

**Automatic Analysis reads `.sonarcloud.properties`; the local `sonar-scanner` CLI reads `sonar-project.properties`.** An exclusion or waiver added to only one is silently ignored by the other, so "clean locally" can coexist with a noisy PR scan.

This drifted in practice: on 2026-07-30, `src/data_layer/public/**` (thousands of lines of kanel-generated code) and the four email-template waivers existed **only** in the CLI config, so the PR-side scan was analysing all of it. **`src/lib/sonarConfigParity.test.ts` now enforces parity** — it compares all three exclusion lists, the waiver set, and that every waiver has a `ruleKey` and `resourceKey` in both files. Add an exclusion to one file and that test goes red. Only `projectKey`, `organization`, `sonar.javascript.lcov.reportPaths`, and `sonar.qualitygate.wait` are legitimately CLI-only.

**Automatic Analysis honours a closed property list — `sonar.issue.ignore.multicriteria` is NOT on it (verified 2026-07-31 against the AutoScan docs; #3933).** AutoScan reads only: `sonar.sources`, `sonar.tests`, the `*.inclusions`/`*.exclusions` families (`sonar.exclusions`, `sonar.inclusions`, `sonar.test.exclusions`, `sonar.test.inclusions`), `sonar.sourceEncoding`, `sonar.cpd.exclusions`, and two language-version keys this repo doesn't use. Consequences:

- Every multicriteria waiver is **inert on the PR-side scan** — this is why 22 findings survived the #3930 sweep with a C security rating. The waivers still work for local `sonar-scanner` runs and are kept for that.
- To silence something on the PR scan, either add a `sonar.exclusions` path (done for `web/src/lib/i18n/locales/**` — the json:S2068 "password" false positives — and `web/src/setupTests.ts` — the S1186 observer stubs) or resolve it once in the SonarCloud UI.
- **Standing UI actions for Alexander (repo config cannot do these):** mark the 11× `typescript:S5693` findings on `src/routes/**` as reviewed/won't-fix (every multer instance already caps `limits.fileSize`; leaving them findings-with-a-verdict is safer than a blanket suppression that would hide a future uncapped route), and mark the 2× `typescript:S2245` jitter hotspots reviewed (security.md carve-out). Same mechanism as the existing `tssecurity` false positives on `instrumentedAxios.ts`.

## Run Sonar locally before pushing — required for non-trivial code changes

**When it's required:** any PR that adds or significantly modifies a function, component, controller, or use case. Skip only for pure dependency bumps, doc/changelog edits, test-only changes, or single-line typo fixes.

**Why it's required:** `/check` (server tsc + arch, web typecheck/vitest/lint — NOT the server Jest suite, NOT format:check) does not run SonarCloud's rule engine. Cognitive complexity, nesting depth, redundant type assertions, and accessibility smells are invisible to local tooling — they surface only after the push, after CI runs, after the agent has already declared the work done. Catching them locally costs 30–90 seconds; catching them post-push costs another rebase + force-push + CI cycle.

**Setup:** already done on the maintainer's box — `sonar-scanner` and `sonar` are on PATH and `sonar auth status` reports `[✓ Connected]` with the token in the OS Keychain. **Run `sonar auth status` before claiming you cannot scan locally**; the absence of a `SONAR_TOKEN` env var proves nothing, and asserting "no SONAR_TOKEN, Sonar not run" put a false statement into roughly seven PR bodies on 2026-07-29. Fresh machine: `brew install sonar-scanner`, then `sonar auth login`.

**Since PR decoration works (2026-07-30), the pre-push local scan is a convenience, not the safety net it used to be.** The `sonarqubecloud` bot now comments the gate result on every PR before merge, so a finding surfaces without a local run. Run locally when you want the answer *before* pushing; skip it when the PR comment is soon enough. Either way, do not claim it ran when it did not.

**Preferred path: the `sonarqube` MCP plugin.** Requires Docker (or Podman/Nerdctl) running — the CLI's `sonar run mcp` shells out to a container, there's no bare-metal mode. Auth reads the token from `sonar auth status` (OS keychain), no `SONAR_TOKEN` env needed. Approve it once via `/mcp` in this repo; if `/mcp` reports `Failed to reconnect to sonarqube: -32000`, Docker isn't running — start it and retry.

Once connected, two different jobs use different tools — don't conflate them:

- **Pre-push, on changed-but-unpushed code:** `mcp__sonarqube__analyze_code_snippet` — runs the real rule engine against a file/snippet locally, no push needed. This is the direct replacement for a local `sonar-scanner` run on your working tree; run it per changed file before flipping a PR ready.
- **Post-push, on a project/PR SonarCloud has already analyzed:** `mcp__sonarqube__get_project_quality_gate_status` (pass/fail + conditions), `mcp__sonarqube__search_sonar_issues_in_projects` (filter by severity/quality/status, scope with `pullRequest` — get the key from `mcp__sonarqube__list_pull_requests`, never a git branch name), `mcp__sonarqube__search_security_hotspots` / `show_security_hotspot` / `change_security_hotspot_status`, `mcp__sonarqube__get_duplications`, `mcp__sonarqube__get_file_coverage_details`. These read SonarCloud's stored analysis — they don't trigger a new scan, so they're only useful once Automatic Analysis has run on the branch/PR (i.e., after a push).

**Fallback: `sonar-scanner` CLI**, if Docker isn't available or the MCP server won't connect (repo root, before flipping a PR ready):

```bash
pnpm test -- --coverage
pnpm --filter 2anki-web test -- --coverage
sonar-scanner -Dsonar.host.url=https://sonarcloud.io
```

Scanner reads `sonar-project.properties`; the report link prints to stdout — resolve new smells **before** pushing. Unset `SONAR_TOKEN` still posts anonymously, link still appears. **If running it locally is impractical** (no Docker, no `SONAR_TOKEN`), say so in the PR body — don't go silent and re-push 30 min later, and don't pretend it ran.

## Before merging: a green gate is NOT zero findings

The quality gate's conditions are ratings (A/A/A on new code), duplication, and hotspot review — **it passes with open MAJOR code smells**, because one finding in a couple hundred new lines doesn't dent a letter rating. So "SonarCloud Code Analysis: SUCCESS" in `statusCheckRollup` proves the gate held, not that the analysis found nothing. 2026-08-02: PR #3960 merged fully green while carrying an open `typescript:S8786` — a ReDoS-class backtracking regex running over user-supplied card HTML on the conversion worker — which then needed a follow-up PR (#3963) after the human spotted it in the SonarCloud UI.

**Rule: before `gh pr merge`, assert the PR analysis has zero open findings — one API call, no auth needed:**

```bash
curl -s "https://sonarcloud.io/api/issues/search?componentKeys=Laer-Smart_2anki.net&pullRequest=<n>&statuses=OPEN,CONFIRMED&sinceLeakPeriod=true" | jq '.total'
```

- `0` → merge.
- **A non-zero `total` can lie: the search API leaks CLOSED issues through the `statuses=OPEN,CONFIRMED` (and `issueStatuses`) filter** — observed 2026-08-11 on PR #4046, where the sole record was `status: CLOSED` (fixed by the head commit) yet `total` read 1 for both filter params. Before treating a non-zero total as a blocker, inspect `.issues[].status` and count only `OPEN`/`CONFIRMED` records; a result set of closed records with the gate `OK` is a clean merge.
- Anything else → list the findings (`.issues[] | {rule, component, line, message}`), fix them on the same branch before merging, or say explicitly in the PR why each one is acceptable and get a nod. Silent merge-with-findings is what this section exists to prevent.
- Run it **after** the `SonarCloud Code Analysis` check reports, or `total` reads 0 vacuously because the analysis hasn't landed yet.
- Merged-PR records never re-scan: a finding fixed in a follow-up stays visible on the old PR's SonarCloud page forever. Judge cleanliness on the *open* PR you're about to merge (and `main`'s branch analysis), not on historical PR records.

## What triggers a security issue

| Rule | Pattern | Safe alternative |
|---|---|---|
| `tssecurity:S5144` / `S7044` | User-controlled URL passed to `axios`/`fetch` | Use `instrumentedAxios` — it validates host against the allowlist |
| `tssecurity:S5131` | User input reflected into HTML without sanitization | `sanitize-html` with project allowlist |
| `javascript:S2068` | String that looks like a hardcoded credential | Read from `process.env`; never use values like `"secret"` or `"password"` as literals |
| `javascript:S5042` | Zip entry extracted without path check | Validate entry name against base dir (see `lib/zip` helpers) |
| `javascript:S4830` | TLS cert validation disabled | Never set `rejectUnauthorized: false` |

**New code path checklist before pushing:**
1. Does any new code pass a user-supplied string to an HTTP call? → route through `instrumentedAxios`.
2. Does any new code render user-supplied content in HTML? → sanitize first.
3. Does any new code extract a zip? → use existing `lib/zip` helpers.
4. Does any new code read a file path from user input? → assert path stays inside the base dir.

## File rename = entire file marked as "new code"

When a PR renames a file (extension change like `.ts → .tsx`, folder move, or anything that breaks Git's rename heuristic for Sonar's diff), Sonar treats every line of the renamed file as new code on the leak period. **Pre-existing patterns surface as new findings.** PR #3068 (Notion block render) had 4 "new" issues — all 4 on lines that existed unchanged before the rename: 3× `typescript:S6836` const-in-case (existing `image`/`audio`/`file` arms) + 1× `typescript:S4123` await-non-Promise (existing `paragraph` arm).

Don't reactively rewrite pre-existing patterns to satisfy the rename. Either:
1. **Mark as False Positive in the SonarCloud UI** with a one-line note "pre-existing pattern, surfaced by file rename in PR #NNNN."
2. **Fix the underlying pattern in a follow-up `refactor:` PR scoped to that fix** — never mix the refactor into the rename PR (the noise hides any genuinely new finding).

Confirm the issue is genuinely pre-existing by checking the line against the pre-rename file (`git show <pre-rename-sha>:<old-path>`). If it's pre-existing, the rename made it visible; the PR didn't introduce it.

## Handling false positives

`tssecurity` taint findings (S5144, S7044) **cannot** be suppressed via `sonar.issue.ignore.multicriteria` — the rule engine ignores multicriteria for taint flows. The only options are:

1. **Rearchitect** so the taint no longer reaches the sink (preferred — often the right call).
2. **Mark as False Positive in the SonarCloud UI** (Issues → the finding → Change Status → False Positive). Add a one-line note explaining why. Alexander must do this for tssecurity FPs; they are not auto-suppressed.

The existing FPs in `instrumentedAxios.ts` (S5144/S7044) are already marked in the UI. The URL passes through `validateAndResolveUrl()` → `isHostOnFixedAllowlist()` / `resolveHostnameSafely()` — Sonar's taint engine cannot follow that chain.

## Existing rule waivers (in `sonar-project.properties`)

| Key | Rule | Scope | Why |
|---|---|---|---|
| `mock1` | `javascript:S5122` (CORS) | `web/mock-server/**` | Mock server is intentionally permissive |
| `mock2` | `javascript:S5689` (method exposure) | `web/mock-server/**` | Same |
| `test1` | `javascript:S2068` (hardcoded credential) | `web/tests/**` | Playwright fixtures use placeholder credentials |
| `test2` | `javascript:S1481` (unused variable) | `web/tests/**` | Test helpers declare but don't always use locals |
| `gen1/gen2` | all rules | `web/src/generated/**`, `web/src/schemas/**` | Generated code — don't edit |
| `email1-4` | `Web:S1827`, `Web:S5257`, `Web:S6819`, `css:S7924` | `src/services/EmailService/templates/**` | Email-client HTML needs table layout and inline patterns web rules ban |
| `jitter1/jitter2` | `typescript:S2245` | retry helpers | Backoff jitter is not a security context (security.md carve-out) — never swap for crypto |
| `upload1` | `typescript:S5693` | `src/routes/**` | multer size limits set per-route via `limits.fileSize`; hotspots marked reviewed in the UI |
| (exclusions) | all rules | `src/data_layer/public/**` | Kanel-generated from Postgres schema; rerun `pnpm kanel` instead |
