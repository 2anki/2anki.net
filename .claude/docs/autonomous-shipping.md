# Autonomous shipping

Agents merge and deploy their own non-rail PRs through `/ship`. Alexander reviews only hard-rail PRs and reads a daily digest. Decided 2026-08-26 (PR #4244); this doc is the reference the rules point at.

## Why it is safe to let agents merge

Before this, every merge was a human step — but branch protection on `main` required zero checks and zero reviews, and every real gate lived in a local Claude hook. The human step was a convention, not a mechanism. Now the gate is mechanical and lives in two places:

- **GitHub** — required status checks on `main`: `static (22.20.0)`, `test (22.20.0)`, `build (22.20.0)`, `test-web (22.20.0)`, `playwright (22.20.0)`, with `strict: true` (branch must be up to date). Every workflow runs on every push so a required check is never left pending by a path filter. Applies to Alexander's merges too (`enforce_admins`).
- **The `check-merge-status.py` hook** on every `gh pr merge` from a Claude session — see the gate table.

## The merge gate

| # | Condition | How it is checked |
| --- | --- | --- |
| 1 | PR touches no hard rail | `hard_rails.py` on the PR file list + diff |
| 2 | Every rollup entry COMPLETED and non-FAILURE; every `test*` check RAN; dep changes have a SUCCESS test | `gh pr view --json statusCheckRollup,files` |
| 3 | Review-agent pass marker for the head SHA | `<!-- ship-review: pass sha=<headRefOid> -->` in a PR review or comment; dependabot exempt. **Honor-system**, like the browser attestation: anyone who can comment can post it — it binds the operator's session to having run the review, it does not prove the review ran |
| 4 | SonarCloud: analysis exists for the head SHA, gate `OK`, zero `OPEN`/`CONFIRMED` issues | `sonar_gate.py` via the SonarCloud API — Sonar posts no GitHub check on this repo |
| 5 | Browser attestation (web/src diffs) and changelog (feat/fix) | existing hooks |

Failure modes are deliberate: `gh pr view` tooling errors **fail open** (a broken `gh` must not block a human); the rail diff fetch and Sonar **fail closed** (an unchecked rail or an unscanned merge is the exact gap the gate closes). The Sonar issue search leaks CLOSED records through its status filter (seen 2026-08-11 on #4046), so `sonar_gate.py` counts only records whose own `status` is OPEN/CONFIRMED.

The only bypasses are ones an agent cannot reach from inside a session: merging from the GitHub UI, or launching the session with the env var set (`CLAUDE_SKIP_SAFETY=1 claude`). A `CLAUDE_SKIP_SAFETY=1` prefix typed into a command is deliberately ignored — a PreToolUse hook runs before the shell, and honoring the prefix would let any agent self-bypass the gate (caught by the commit security review on #4244).

## Hard rails

The surfaces an agent never merges: auth, payments/Stripe, subscriptions, checkout, passes, webhooks, the monthly card/print quota use cases and mindmap quota constants, migrations and the generated data layer, `src/server.ts`, everything under `.github/`, the whole harness (`.claude/`, `CLAUDE.md` — so an agent cannot rewrite its own gate, brief, or `/ship` and self-merge), and the prod safety limits. Canonical list: `.claude/hooks/hard_rails.py` (name globs matched anywhere in the path, explicit paths, and content triggers scanned on changed diff lines).

Rail PR flow: the agent still runs the review agent and posts its verdict, flips the PR ready, prints the URL, and stops. Alexander merges from the GitHub UI, where the hook does not run. Widening or narrowing the list is its own PR, never folded into feature work — the list is also itself a rail.

Why not CODEOWNERS: agents run under Alexander's `gh` auth and he authors most PRs; a code-owner review requirement would make his own rail PRs unmergeable (GitHub blocks self-approval).

## `/ship` in one paragraph

Preflight (draft? rail? rebased?) → review agent (`/review-pr` fan-out; two fix rounds max) posts the marker → wait for the rollup and for `sonar_gate.py --wait 300` → `gh pr merge --squash --delete-branch` (hooks re-verify) → find the deploy run for the merge SHA and watch it → `curl /api/version` must report the merge SHA, then `/deploy-status` → on failure, `git revert` on a `revert/<slug>` branch shipped through the same command (review agent skipped for a mechanical revert), comment on the deploy-failure issue → append to today's `Shipped <date>` issue (label `shipped-digest`). Full steps: `.claude/commands/ship.md`.

Sanctioned carve-outs inside `/ship` only: starting `pnpm dev` for the browser attestation (kill it after), and the read-only `/deploy-status` SSH.

## The digest

One GitHub issue per UTC day, `Shipped YYYY-MM-DD`, label `shipped-digest`, one comment per merged PR: link, one line what/why, the PR body's `## Decisions` block verbatim, deploy verdict. This is where Alexander overrides a trio call — reply on the issue or open a follow-up. Trio decisions therefore **must** land in the PR body under `## Decisions` (the `overnight-prs` format), or the digest has nothing to surface.

## Throughput

Docs-only pushes (`.claude/**`, `Documentation/**`, `*.md` outside `web/`) still run every required job, but each job asks `.github/actions/changes` first and finishes in seconds when nothing needs building — a `paths-ignore` would leave the required checks unreported and the PR blocked forever. `strict: true` means a PR behind `main` must rebase and re-run CI before it can merge; two concurrent `/ship` runs serialize at roughly ten minutes per PR. Dependabot PRs behind `main` need `@dependabot rebase`. If this hurts, the next step is GitHub's merge queue (workflows would need the `merge_group` trigger) — not loosening `strict`.

## Rolling it out / rolling it back

- Branch protection was applied 2026-08-26 with `gh api -X PUT repos/2anki/2anki.net/branches/main/protection` — use the canonical repo name for writes, `gh api` does not follow the rename redirect (`2anki/server` answers a PUT with HTTP 307). To read the current state: `gh api repos/2anki/server/branches/main/protection`.
- To pause autonomous merging without touching code, set `required_approving_review_count` to 1 in branch protection — every merge then waits for a human approval. Restore with the same PUT.
- If SonarCloud's GitHub status check is ever enabled in the SonarCloud UI, add its context to the required list and keep `sonar_gate.py` as the finding-count check (the GitHub check reports the gate, not the count).
