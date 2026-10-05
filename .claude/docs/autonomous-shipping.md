# Autonomous shipping

Agents merge and deploy their own PRs through `/ship`, hard-rail PRs included. Alexander reviews the merged-PR list. Decided 2026-08-26 (PR #4244); rail PRs became agent-merged on 2026-10-05. This doc is the reference the rules point at.

## Why it is safe to let agents merge

Before this, every merge was a human step — but branch protection on `main` required zero checks and zero reviews, and every real gate lived in a local Claude hook. The human step was a convention, not a mechanism. Now the gate is mechanical and lives in two places:

- **GitHub** — required status checks on `main`: `static (22.20.0)`, `test (22.20.0)`, `build (22.20.0)`, `test-web (22.20.0)`, `playwright (22.20.0)`, with `strict: true` (branch must be up to date). Every workflow runs on every push so a required check is never left pending by a path filter. Applies to Alexander's merges too (`enforce_admins`).
- **The `check-merge-status.py` hook** on every `gh pr merge` from a Claude session — see the gate table.

## The merge gate

| # | Condition | How it is checked |
| --- | --- | --- |
| 2 | Every rollup entry COMPLETED and non-FAILURE; every `test*` check RAN; dep changes have a SUCCESS test | `gh pr view --json statusCheckRollup,files` |
| 3 | Review-agent pass marker for the head SHA | `<!-- ship-review: pass sha=<headRefOid> -->` in a PR review or comment; dependabot exempt. **Honor-system**, like the browser attestation: anyone who can comment can post it — it binds the operator's session to having run the review, it does not prove the review ran |
| 5 | Browser attestation (web/src diffs) and changelog (feat/fix) | existing hooks |

`gh pr view` tooling errors **fail open** (a broken `gh` must not block a human). SonarCloud was a fifth condition until 2026-10-01; it was removed because it added a serial wait that timed out on 8% of PRs while `main` carried 1,102 unactioned findings, the gate rating only new code.

The only bypasses are ones an agent cannot reach from inside a session: merging from the GitHub UI, or launching the session with the env var set (`CLAUDE_SKIP_SAFETY=1 claude`). A `CLAUDE_SKIP_SAFETY=1` prefix typed into a command is deliberately ignored — a PreToolUse hook runs before the shell, and honoring the prefix would let any agent self-bypass the gate (caught by the commit security review on #4244).

## Hard rails

`.claude/hooks/hard_rails.py` lists the high-blast-radius surfaces: auth, payments/Stripe, subscriptions, checkout, passes, webhooks, quota constants, migrations and the generated data layer, `src/server.ts`, `.github/`, the harness (`.claude/`, `CLAUDE.md`) and the prod safety limits. It no longer blocks a merge. `/ship` uses it to classify the PR and, on a hit, runs the matching extra verification before and after the merge (`.claude/commands/ship.md`, step 1b and step 6b). A rail PR merges on that evidence; it does not wait for Alexander.

## `/ship` in one paragraph

Preflight (draft? rail class? rebased?) → rail verification when the classifier hits → review agent (`/review-pr` fan-out; two fix rounds max) posts the marker → wait for the rollup → `gh pr merge --squash` enqueues in the merge queue (hooks re-verify; `--delete-branch` is rejected while the queue is on) → poll the PR until `state: MERGED` (a dequeue means a required job failed on the `gh-readonly-queue/…` branch; one retry for a diff-unrelated flake, then stop) → find the deploy run for the merge SHA and watch it → `curl /api/version` must report the merge SHA, then `/deploy-status` → on failure, `git revert` on a `revert/<slug>` branch shipped through the same command (review agent skipped for a mechanical revert), comment on the deploy-failure issue. Full steps: `.claude/commands/ship.md`.

Sanctioned carve-outs inside `/ship` only: starting `pnpm dev` for the browser attestation (kill it after), and the read-only `/deploy-status` SSH.

## Decisions and manual steps

Trio decisions land in the PR body under `## Decisions` (the `overnight-prs` format). The merged PR is where Alexander overrides a call — comment on it or open a follow-up. A step only Alexander can do (a prod secret, a Stripe dashboard setting, a third-party account) ships behind a safe default and goes in the final report to him, one line per step. Do not open `Needs you` issues; they were dropped on 2026-10-05 because they piled up as issues to close. The daily `Shipped <date>` digest issues (label `shipped-digest`, 2026-08-26 to 2026-09-08) were dropped: they duplicated `gh pr list --state merged` and cost an issue a day to close. Agents never create one.

## Throughput

Docs-only pushes (`.claude/**`, `Documentation/**`, `*.md` outside `src/` and `web/` — oxfmt formats Markdown under both, so those stay code) still run every required job, but each job asks `.github/actions/changes` first and finishes in seconds when nothing needs building — a `paths-ignore` would leave the required checks unreported and the PR blocked forever. `strict: true` means a PR behind `main` must rebase and re-run CI before it can merge; two concurrent `/ship` runs serialize at roughly ten minutes per PR. Dependabot PRs behind `main` need `@dependabot rebase`. The merge queue is now on (since 2026-09-10): the required workflows run on the queue's `gh-readonly-queue/main/pr-<n>-<sha>` push branch, so no `merge_group` trigger was needed, and a PR behind `main` no longer has to rebase — the queue builds it on top of `main` itself. `gh pr merge` therefore enqueues rather than merges; `/ship` step 4 describes the wait and the dequeue handling.

## Rolling it out / rolling it back

- Branch protection was applied 2026-08-26 with `gh api -X PUT repos/2anki/2anki.net/branches/main/protection` — use the canonical repo name for writes, `gh api` does not follow the rename redirect (`2anki/server` answers a PUT with HTTP 307). To read the current state: `gh api repos/2anki/server/branches/main/protection`.
- To pause autonomous merging without touching code, set `required_approving_review_count` to 1 in branch protection — every merge then waits for a human approval. Restore with the same PUT.
