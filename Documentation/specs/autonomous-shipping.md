# Autonomous shipping: agents merge and deploy through `/ship`

Decided with Alexander on 2026-08-26 (brainstorm, not a trio spec — this changes the harness, not the product).

- **Outcome**: an agent that finishes a non-rail change merges it and verifies the deploy without a human in the loop. Alexander reviews only hard-rail PRs and reads a daily digest.
- **Approach chosen**: GitHub-native required checks + hook-enforced gate + one `/ship` command. Rejected: hook-only (guards Claude sessions only) and a bot-driven auto-merge Action (duplicates hook logic, needs a bot token).
- **What replaces human review**: CI green + Sonar clean + one fresh-context review-agent pass.
- **Metric**: none — internal. Proxy to read weekly: agent-merged PRs per week (`mergedBy` is still `aalemayhu` since agents run under that auth; count PRs carrying the `ship-review` marker instead).

## Problem

Every merge today is a human step. Branch protection on `main` requires zero status checks and zero reviews; every real gate lives in local Claude hooks (`check-merge-status.py`, `check-browser-attestation.py`, `check-changelog-on-merge.py`). Agents stop at "ready for review" because prose tells them to (`overnight-prs.md`, `drive-acquisition.md`, `engineer.md`, `implement.md`, CLAUDE.md), not because anything blocks them. The last 25 merges were all authored and merged by Alexander. Deploy is already autonomous: push to `main` runs blue-green with a health gate and a last-good restore.

Two findings that shape the mechanism:

- SonarCloud does not post a GitHub check on this repo (rollup on #4225 and #4231 has no `SonarCloud Code Analysis` entry) even though the analysis exists via the API (gate `OK`, 0 findings on #4225). The gate must poll the Sonar API.
- CODEOWNERS cannot enforce hard rails. Alexander authors most PRs and agents run under his `gh` auth; a code-owner review requirement on rail paths would make his own rail PRs unmergeable. Rails are hook-enforced.

## Scope

In:

1. The merge gate, mechanically checked in `check-merge-status.py` on every `gh pr merge`.
2. Hard-rail path list in `.claude/hooks/hard_rails.py`; rail PRs never auto-merge.
3. `/ship <pr>` command: review agent → wait green → merge → watch deploy → verify prod → revert on failure → digest.
4. GitHub-native required status checks with no-op sibling workflows for path-filtered jobs.
5. Prose rewrite: every "NEVER merge" becomes "merge via `/ship`".
6. `.claude/docs/autonomous-shipping.md` as the on-demand reference.

Out (do not build):

- GitHub merge queue (phase 2 if serial throughput hurts).
- Cloud/GitHub-Action agents merging (`claude.yml`). Required checks protect that path; adoption is a later change.
- Any change to the deploy workflow itself, blue-green script, or last-good restore.
- Making Sonar a GitHub check — that is a SonarCloud UI setting Alexander flips; when he does, add it to the required contexts.
- Rail PRs merging without Alexander.

## 1. The merge gate

`check-merge-status.py` denies `gh pr merge` unless all of these hold:

| # | Condition | Source | Failure mode |
| --- | --- | --- | --- |
| 1 | Every rollup entry COMPLETED and non-FAILURE; every `test*` check RAN; dep changes have a SUCCESS test | existing | deny |
| 2 | Required GitHub checks green (`static`, `test`, `build`, `playwright`) | GitHub branch protection (belt) + hook (braces) | GitHub refuses / deny |
| 3 | Sonar analysis exists for the head SHA, quality gate `OK`, zero issues whose `status` is `OPEN` or `CONFIRMED` (count real statuses only — the search API leaks CLOSED records through the status filter, seen 2026-08-11 on #4046) | `https://sonarcloud.io/api/qualitygates/project_status?projectKey=Laer-Smart_2anki.net&pullRequest=<n>` and `.../api/issues/search?componentKeys=…&pullRequest=<n>&sinceLeakPeriod=true` | Poll up to 5 min for the head-SHA analysis; **fail closed** if it never appears. Unlike `gh` tooling errors (fail-open), an unscanned merge is the exact gap the gate exists to close. |
| 4 | Review-agent pass marker on the head SHA: a PR review or comment containing `<!-- ship-review: pass sha=<headRefOid> -->` | `gh pr view <n> --json reviews,comments,headRefOid` | deny; SHA mismatch means the branch moved after review — re-review |
| 5 | Browser attestation and changelog hooks pass | existing hooks | deny |
| 6 | PR touches no hard-rail path | `hard_rails.py` | deny, no bypass except `CLAUDE_SKIP_SAFETY=1`, which `/ship` never sets |

Dependabot PRs keep their existing exemptions (attestation, changelog) and additionally skip condition 4 — the `/batch dependabot` worker's decision matrix is their review.

## 2. Hard rails

`hard_rails.py` exports `is_rail(paths) -> list[str]` (the matched paths, empty when clean). Case-insensitive name globs on any path segment, plus explicit paths. Widening or narrowing the list is its own PR, never folded into feature work.

Name globs (match anywhere in the path, tests included): `*auth*`, `*stripe*`, `*subscription*`, `*checkout*`, `*webhook*`, `*password*`, `*login*`, `*oauth*`, `*session*`, `*jwt*`, `*pricing*`, `*signup*`. Verified 2026-08-26: these hit 67 non-test files under `src/` (controllers, routers, use cases, Stripe helpers, auth middleware, session tokens).

Explicit paths:

- `migrations/**`, `src/data_layer/public/**`
- `.github/workflows/**`, `scripts/deploy-*`, `ecosystem.blue-green.config.js`
- `.claude/hooks/**`, `.claude/settings.json`
- `src/lib/isPaying.ts`, `src/lib/ankify/access.ts`
- `src/services/EmailService/templates/subscription-*`, `src/services/EmailService/templates/abandoned-checkout-*`

Content triggers (diff contains the string): `AUTO_SYNC_PRODUCT_ID`, `max_memory_restart`, `max-old-space-size`, `process.env.SECRET`.

Rail PR flow for an agent: flip ready, run the review agent and post its result, print the PR URL, stop. Alexander merges in the GitHub UI (the hook never sees him there).

## 3. `/ship <pr>`

`.claude/commands/ship.md`. The only path that runs `gh pr merge` from an agent. Steps:

1. **Preflight.** `gh pr view <n> --json isDraft,files,headRefName,headRefOid,body`. Draft → stop. Rail → rail flow above. `git fetch origin && git rebase origin/main`; `git push --force-with-lease` if the base moved.
2. **Review agent.** Run the `/review-pr` fan-out (security / engineering / ux-voice forks, fresh context, diff only). Must-fix → fix on the branch, push, repeat from step 1. Max two rounds; a third must-fix leaves the PR ready with the blocker in a comment and stops. Clean → `gh pr review <n> --comment --body "<summary>\n\n<!-- ship-review: pass sha=<headRefOid> -->"`. For `web/src/` diffs, this step also performs the browser attestation: start `pnpm dev` (or the mock server), run the golden path at 375px through the Playwright MCP, tick the boxes with `gh pr edit --body`, and kill the server before continuing. This is the one sanctioned carve-out to "ask before starting the server".
3. **Wait green.** `Monitor` or `ScheduleWakeup` on `statusCheckRollup` until every entry is COMPLETED — never busy-poll. Then poll the Sonar API for the head SHA.
4. **Merge.** `gh pr merge <n> --squash --delete-branch`. The hook re-verifies Section 1. A deny stops the command and reports the reason; never bypass.
5. **Watch deploy.** Merge of a `.md`-only diff triggers no deploy (`paths-ignore: '**.md'`) → report "merged, no deploy" and go to step 8. Otherwise `gh run list --workflow deploy.2anki.net.yml --branch main --json databaseId,headSha` → the run for the merge SHA → `gh run watch <id>`.
6. **Verify prod.** `curl -fsS https://2anki.net/api/version | jq -r .sha` equals the merge SHA, then `/deploy-status` (read-only SSH; sanctioned inside `/ship` as the one exception to the engineer's "never touch the prod host").
7. **Failure.** Deploy run failed or `/deploy-status` verdict is "broken": `git revert <mergeSha>` on `revert/<slug>`, push, `gh pr create`, `/ship` it. A pure `git revert` of the PR just merged skips step 2 (CI and the hook still gate). Comment the revert PR URL on the auto-opened deploy-failure issue.
8. **Digest.** Find or create today's issue titled `Shipped <YYYY-MM-DD>` with label `shipped-digest`. Append one comment: PR URL, title, one line what/why, the PR body's `## Decisions` block verbatim if present, deploy verdict (sha, `/deploy-status` one-liner or "no deploy").

Concurrency: `strict: true` on branch protection means a PR behind `main` cannot merge; the second of two concurrent `/ship` runs rebases and waits for CI again. Serial, roughly ten minutes per PR. Acceptable now; merge queue is the phase-2 fix.

## 4. GitHub-native enforcement

Branch protection on `main` (one `gh api -X PUT repos/2anki/server/branches/main/protection` call, applied **after** the no-op workflows are on `main`):

- `required_status_checks.strict = true`, `contexts = ["static (22.20.0)", "test (22.20.0)", "build (22.20.0)", "playwright (22.20.0)"]`
- `enforce_admins = true` (unchanged; applies to Alexander's merges too)
- `required_pull_request_reviews` unchanged (count 0, code-owner review on, no CODEOWNERS file)

Path-filtered workflows (`server.yml` ignores `web/**`; `web.yml` and `playwright.yml` run only on web paths) would leave a required check missing forever on PRs that skip them. Fix per GitHub's documented "skipped but required checks" pattern: `server-noop.yml`, `web-noop.yml`, `playwright-noop.yml` with the **inverse** path filters and identically-named jobs that run `exit 0`. `test (22.20.0)` exists in both server and web workflows; both must pass, which is the intent.

## 5. Prose and brief changes

| File | Change |
| --- | --- |
| `CLAUDE.md` › Git | "ship it: commit, push, open PR ready" → "commit, push, open PR, run `/ship`". New **Autonomous shipping** block: gate summary, pointer to rails, `/ship` is the only agent merge path, rail PRs wait in the GitHub UI. Fold the now-redundant merge-gate bullets into a pointer at `.claude/docs/autonomous-shipping.md`. |
| `.claude/commands/overnight-prs.md` | Tier 1 and Tier 2 → `/ship` after open. Tier 3 stays draft. Safety rule "NEVER merge" → "merge only via `/ship`; never `gh pr merge` directly; never on rails". Summary gains a "Merged + deployed" bucket; "PRs open for review" lists rails and Tier 3 only. |
| `.claude/commands/drive-acquisition.md` | Same swap. |
| `.claude/commands/implement.md` | After `gh pr ready` → `/ship`. |
| `.claude/agents/engineer.md` | "print PR URL for Alexander" → "run `/ship`; end with PR URL + deploy verdict". "Never run anything on the prod host" gains the read-only `/deploy-status`-inside-`/ship` carve-out. |
| `.claude/agents/_trio.md` | Ship-ready gate terminal state = merged via `/ship`, deploy verified. Trio decisions must land in the PR body under `## Decisions` (digest source). |
| `.claude/commands/review-pr.md` | Own-author auto-merge clause → "hand off to `/ship`". One merge path. |
| `.claude/commands/batch.md` + dependabot worker | Unchanged (already hook-gated; review-marker exempt). |
| `.claude/docs/autonomous-shipping.md` (new) | Gate table, rail list rationale, marker format, revert path, digest format, how to widen rails, Sonar fail-closed rationale. Listed in CLAUDE.md's on-demand docs. |

## 6. Hook code and tests

- `.claude/hooks/hard_rails.py` + `hard_rails.test.py`: globs and explicit paths; cases for a clean PR, a name-glob hit, an explicit-path hit, a content-trigger hit, case-insensitivity.
- `check-merge-status.py` + new `check-merge-status.test.py` (there is none today): rail deny; Sonar poll with fake HTTP (gate OK / gate ERROR / CLOSED-leak case / analysis never appears → deny); review marker present / absent / wrong SHA; dependabot exemption. Existing hooks' `.test.py` files show the pattern (stdin JSON in, decision JSON out).
- Three `*-noop.yml` workflows.
- No `src/` or `web/src/` changes.

## 7. Rollout

1. This PR (hooks, command, docs, workflows) touches `.claude/hooks/**` and `.github/workflows/**` — it is itself a rail. Alexander merges it in the UI.
2. Apply branch protection via `gh api` once the no-op workflows are on `main`.
3. First live run: `/ship` on a small non-rail PR with Alexander watching. Confirm the digest issue, the marker, and the deploy verification all fire.
4. Day-7 check: count PRs with the marker; read the digest issues; confirm no rail PR merged without a human.

## Non-goals restated

Faster merges are not the goal; unattended-but-gated merges are. Do not weaken any existing hook to make `/ship` pass more often. If the gate blocks, the fix is on the branch, not in the hook.
