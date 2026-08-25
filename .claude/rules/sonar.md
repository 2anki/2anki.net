# SonarCloud quality gate

PR decoration reports the gate on every push (org `laer-smart`, project key `Laer-Smart_2anki.net`). A local `sonar-scanner`/MCP run is a convenience, not a gate — **never claim it ran when it did not**; write "Sonar: not run locally; PR decoration will report" instead. The gate has no coverage condition (AutoScan uploads no lcov) — do not add one without wiring CI coverage first. `tssecurity` taint findings (S5144/S7044) cannot be waived in config; Alexander marks them False Positive in the SonarCloud UI. Setup, scope traps, the two-config parity rule, file-rename noise, and false-positive handling: `.claude/docs/sonar.md`.

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
