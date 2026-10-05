---
description: Merge and deploy a finished PR unattended — review agent → gate → merge → watch deploy → verify prod
argument-hint: <PR number or URL>
allowed-tools: Bash, Read, Grep, Glob, Agent, Monitor, ScheduleWakeup
---

You are shipping PR `$ARGUMENTS`. This is the **only** path an agent uses to run `gh pr merge`. Never call it outside this flow, never try to bypass the hook (a `CLAUDE_SKIP_SAFETY=1` prefix is ignored by design), never weaken a hook to get through — if the gate blocks, the fix goes on the branch. Reference: `.claude/docs/autonomous-shipping.md`.

## 1. Preflight

```bash
gh pr view <n> --repo 2anki/server --json number,isDraft,files,headRefName,headRefOid,body,author,statusCheckRollup
```

- Draft → stop; report "still draft".
- Rail class? Run the classifier on the file list and diff:
  ```bash
  gh pr view <n> --json files --jq '.files[].path' > /tmp/ship-paths.txt
  gh pr diff <n> > /tmp/ship-diff.txt
  python3 -c "import sys; sys.path.insert(0,'.claude/hooks'); import hard_rails as r; p=open('/tmp/ship-paths.txt').read().split(); print(r.rail_paths(p)); print(r.rail_content_hits(open('/tmp/ship-diff.txt').read()))"
  ```
  Any hit → run the matching checks in step 1b before step 2, and step 6b after the deploy. A rail PR merges on that evidence; it does not stop and wait for Alexander.
- Bring the branch up to date: `gh pr checkout <n>`, `git fetch origin main`, `git rebase origin/main`. If the rebase moved HEAD, `git push --force-with-lease origin <branch>` and re-read `headRefOid`.

## 1b. Rail verification (only when step 1 hit)

Run every row that matches the hit. Any failure → fix on the branch and restart from step 1.

| Hit | Before merge |
| --- | --- |
| `migrations/`, `src/data_layer/public/` | `migration-reviewer` agent on the diff; apply `migrate:latest` then `migrate:rollback` then `migrate:latest` against local Postgres; confirm kanel output is committed and matches |
| Stripe, checkout, subscription, webhook, passes, pricing | Add `security` focus to the review; check the touched Stripe objects and webhook events exist in live mode with the Stripe MCP (read only); test that signature verification still runs on the raw body |
| auth, login, oauth, session, jwt, password, signup | `/security-review` on the diff; full server suite |
| Quota constants, prod safety limits | Find the evidence that set the old value (`git log -S` plus pm2 logs, per `.claude/docs/prod-ops.md`) and state it in the PR body |
| `.github/`, `scripts/deploy-` | Read the workflow diff for removed gates; the PR's own CI run must exercise the changed job |
| `.claude/`, `CLAUDE.md` | Run every touched hook's `*.test.py` |

## 2. Review agent

Run the review fan-out on `<n>` (security / engineering / ux-voice, fresh context, diff only) and read the synthesized verdict.

**`review-pr` is switched off in `.claude/settings.local.json`, so invoke the reviewers yourself** with the `Agent` tool rather than the skill — one agent per dimension, each briefed to read the diff and report BLOCKING / NON-BLOCKING / verdict with no edits, commits or merges. **Never use `subagent_type: "fork"` for a reviewer.** A fork inherits this whole ship task, the shared worktree and the operator's `gh` auth, and on #4679 three read-only-briefed forks edited, force-pushed, posted markers and enqueued the merge themselves. Use a fresh read-only type (`caveman:cavecrew-reviewer`), save the diff to a scratchpad file first, and pass only the diff path and the review brief, never the ship steps. The marker you post in a moment is the merge gate's only substantive review condition, so it must stand for a review that actually ran. Do not post it on the strength of your own reading alone.

- **Blocking findings** → fix them on the branch, commit, push, and start again from step 1. Two rounds maximum. A third round of must-fix means the change is not ready: leave the PR ready, comment the blocker, print the URL, stop.
- **Clean** → post the pass marker for the exact head SHA:
  ```bash
  HEAD=$(gh pr view <n> --json headRefOid --jq .headRefOid)
  gh pr review <n> --comment --body "$(printf '%s\n\n<!-- ship-review: pass sha=%s -->' "<one-paragraph verdict>" "$HEAD")"
  ```
  The marker is what `check-merge-status.py` looks for. It is bound to the SHA — any later push invalidates it and you re-review.

**Browser attestation for `web/src/` diffs happens here.** If the diff touches `web/src/` (beyond changelog JSON) and the PR body carries neither the two ticked checkboxes nor the `Browser check: not applicable —` out-clause: start the dev server (`pnpm dev`, sanctioned inside `/ship` only), walk the golden path at 375px through the Playwright MCP, confirm no console errors, tick the boxes with `gh pr edit <n> --body`, then **kill the dev server** before moving on (`scripts/reap-orphans.sh --force` if a process survives). If the change has no runtime-visible effect, write the out-clause honestly instead — never claim a check you did not run.

## 3. Wait for green

```bash
gh pr view <n> --json statusCheckRollup --jq '.statusCheckRollup[] | "\(.name // .context) \(.status // .state) \(.conclusion // "")"'
```

Every entry must be COMPLETED and non-FAILURE. Don't busy-poll — use `Monitor` on that command, or `ScheduleWakeup` (270s) when a run has minutes left. A FAILURE → read the log (`gh run view <id> --log-failed`), fix on the branch, restart from step 1.

## 4. Merge (through the merge queue)

`main` merges through GitHub's merge queue (squash strategy set by the queue rule; `--delete-branch` is rejected while the queue is on). `gh pr merge` **enqueues** — it does not merge, and `mergeCommit` stays `null` until the queue lands the PR.

```bash
gh pr merge <n> --repo 2anki/server --squash
```

The `check-merge-status.py`, `check-browser-attestation.py`, and `check-changelog-on-merge.py` hooks re-verify everything before the enqueue. A deny prints the reason — act on it, never bypass.

Then wait for the queue. The queue builds `main` + the PR on a `gh-readonly-queue/main/pr-<n>-<sha>` branch and runs the required workflows there; that takes about seven minutes when the queue is idle. Poll with `Monitor` (60 s interval) on:

```bash
gh api graphql -f query='{ repository(owner:"2anki", name:"2anki.net") { pullRequest(number:<n>) { state mergeCommit { oid } mergeQueueEntry { state position } } } }'
```

- `state: MERGED` → record `MERGE_SHA` from `mergeCommit.oid` and continue.
- `state: OPEN` with `mergeQueueEntry: null` → the queue **dequeued** the PR: a required job failed on the queue branch. Find it with `gh run list --limit 30 --json databaseId,headBranch,conclusion` filtered to `headBranch` starting with `gh-readonly-queue/main/pr-<n>-`, read `--log-failed`, and decide: a fix goes on the branch (restart from step 1); a flake that never touches the diff (a fixture timeout on a busy runner, say) → re-run `gh pr merge <n> --squash` once and watch again. Two dequeues in a row is not a flake — stop and report.

Never delete the branch by hand before the queue has merged; the queue needs it.

## 5. Watch the deploy

A merge whose diff is only `*.md` files triggers no deploy (`paths-ignore: '**.md'`) — go to step 7 (local cleanup still applies; it'll report "merged, no deploy" from there).

```bash
gh run list --repo 2anki/server --workflow deploy.2anki.net.yml --branch main --limit 5 --json databaseId,headSha,status,conclusion
```

Find the run whose `headSha` is `$MERGE_SHA` (it appears within ~30s of the queue merge; `ScheduleWakeup` 60s if not yet listed). Then `gh run watch <id> --exit-status` — deploys take 6–10 minutes; prefer `ScheduleWakeup` 270s or a `Monitor` over holding the shell.

## 6. Verify prod

```bash
curl -fsS https://2anki.net/api/version | jq -r .sha
```

Must equal `$MERGE_SHA`. Then run `/deploy-status` (read-only SSH; this is the one sanctioned exception to "never touch the prod host"). Verdict "deploy healthy" → step 6b for a rail PR, step 7 otherwise.

## 6b. Rail verification after deploy (only when step 1 hit)

- Migration: read-only prod psql (`PGOPTIONS="-c default_transaction_read_only=on"`) confirms the `knex_migrations` row and the new schema; pm2 logs show no query errors since the deploy.
- Stripe or webhooks: Stripe MCP shows webhook deliveries since the deploy succeeding (no new 4xx/5xx); pm2 logs show no Stripe errors; a checkout session can still be created if checkout changed.
- Auth: pm2 logs show successful logins since the deploy and no spike in 401/500 on auth routes.

Watch for 15 minutes after the deploy. Any regression → step 8 revert.

## 7. Local cleanup

Runs on the success path only (healthy deploy, or a merge with no deploy) — skip if you're headed to step 8 instead. "Merge" here means the queue's `state: MERGED` from step 4, never the enqueue moment; the branch only exists to delete once that's confirmed.

If this checkout is still on the just-merged branch: `git checkout main && git pull --ff-only`, then `git branch -D <branch>` (squash-merges leave the tip unreachable from main, so `-d` refuses), `git fetch --prune origin`, and `git worktree remove <path>` if a dedicated worktree carried this PR. Skip silently if the checkout is already on a different branch — nothing to clean up here.

## 8. Failure → revert

If the deploy run failed, `/api/version` does not report the merge SHA after the run finished, or `/deploy-status` says "broken":

1. `git checkout main && git pull --ff-only && git checkout -b revert/<slug>`
2. `git revert --no-commit $MERGE_SHA && git commit -m "revert: <original subject>" -m "Deploy run <run URL> failed after merging #<n>: <one line on what broke>."` — git's default `Revert "…"` subject fails the conventional-prefix hook, so write the subject yourself (≤72 chars).
3. `git push -u origin revert/<slug>` and `gh pr create --repo 2anki/server --base main --head revert/<slug>` with a body that links the failed run and the original PR.
4. Ship the revert through this command. A pure `git revert` of the PR just merged skips step 2's review agent: post the marker directly with the verdict "mechanical revert of #<n> after a failed deploy". CI and the hooks still gate it.
5. Comment the revert PR URL on the deploy-failure issue the workflow opened (`gh issue list --repo 2anki/2anki.net --search "Production deploy failed" --state open` — the search API does not follow the `2anki/server` rename, so list/search calls use the canonical name).
6. Reopen the original issue if the PR had closed one, with one line on what failed.

## Report

End with two lines: the PR URL, and the deploy verdict (`healthy <sha>` / `no deploy` / `reverted → <revert PR URL>`).

Trio calls stay in the PR body under `## Decisions`; Alexander overrides one by commenting on the merged PR or opening a follow-up. If the PR leaves a step only Alexander can do (a prod secret, a Stripe dashboard setting, confirming on a specific account), ask Alexander for it in the chat. Do not open a `Needs you` issue. Do not create a daily `Shipped <date>` digest issue: those were dropped 2026-09-08 because they duplicated the merged-PR list and added an issue a day to close.
