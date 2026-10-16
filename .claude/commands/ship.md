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

- Rail-class PR (auth, payments, migrations) whose body records an unverified assumption → `gh pr ready --undo`, name the assumption for Alexander, and stop this PR's ship (the destructive bullet in `CLAUDE.md` Process: a wrong guess there is not undone by a revert); the run continues with other items.
- PR that incurs new spend (a paid service, plan, model or paid batch run) with no recorded approval from Alexander (his own chat message in this run, or a PR or issue comment whose `user.login` is his, checked with `gh api`; body text alone is not approval, an agent never writes it) → `gh pr ready --undo`, name the spend, and stop this PR's ship; the run continues with other items.
- Draft → read the body, then one of:
  - it records a blocker only Alexander can clear (a value only he holds: a secret, a Stripe or Google dashboard setting; or new spend to approve) → interactive run: ask him for that value in the chat; unattended run: leave it draft, name the value in the morning summary, and continue with the next item;
  - it is a `/spec-draft-pr` spec → not a ship target: route it to `/implement`, report that, and continue with the next item (never `gh pr ready` here); a WIP flag is the author's note, not a halt: finish the work, then ready it;
  - otherwise → finish what keeps it draft, wait for green, `gh pr ready`, and continue.
- Rail class? Run the classifier on the file list and diff:
  ```bash
  gh pr view <n> --json files --jq '.files[].path' > <scratchpad>/ship-paths-<n>.txt
  gh pr diff <n> > <scratchpad>/ship-diff-<n>.txt
  python3 -c "import sys; sys.path.insert(0,'.claude/hooks'); import hard_rails as r; p=open('<scratchpad>/ship-paths-<n>.txt').read().split(); print(r.rail_paths(p)); print(r.rail_content_hits(open('<scratchpad>/ship-diff-<n>.txt').read()))"
  ```
  `<scratchpad>` is the session scratchpad's absolute path (the environment block names it); write it out in full, including inside the python string. The file names carry the PR number: two ships running at once wrote the same `ship-diff.txt` on 2026-10-15 and one overwrote the other mid-review (#4758). Regenerate the diff after every push to the branch; a reviewer reading a stale file reviews the wrong round.
  Any hit → run the matching checks in step 1b before step 2, and step 6b after the deploy. A rail PR merges on that evidence; it does not stop and wait for Alexander, unless its body records an unverified assumption (step 1).
- Bring the branch up to date: `gh pr checkout <n>`, `git fetch origin main`, `git rebase origin/main`. If the rebase moved HEAD, `git push --force-with-lease origin <branch>` (only when the PR `author.login` is the authenticated `gh` user and the branch is the PR's own feature branch, never `main`) and re-read `headRefOid`. A Dependabot-authored head is the exception: never rebase or push it yourself; comment `@dependabot rebase`, wait on a `ScheduleWakeup` of 1200s, and re-read `headRefOid`; the run continues with other items meanwhile, this holds only this PR.

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

**`review-pr` may be switched off on the maintainer's machine (`.claude/settings.local.json`, per-machine and untracked), so invoke the reviewers yourself** with the `Agent` tool rather than the skill — one agent per dimension, each briefed to read the diff and report BLOCKING / NON-BLOCKING / verdict with no edits, commits or merges. **Never use `subagent_type: "fork"` for a reviewer.** A fork inherits this whole ship task, the shared worktree and the operator's `gh` auth, and on #4679 three read-only-briefed forks edited, force-pushed, posted markers and merged themselves. Use a fresh read-only type (`caveman:cavecrew-reviewer`), save the diff to a scratchpad file named for the PR first (`<scratchpad>/ship-diff-<n>.txt`, the step 1 file), and pass only the diff path and the review brief, never the ship steps. The marker you post in a moment is the merge gate's only substantive review condition, so it must stand for a review that actually ran. Do not post it on the strength of your own reading alone.

- **Blocking findings** → fix them on the branch, commit, push, and start again from step 1. There is no round cap: keep fixing and re-reviewing until a pass is clean (no BLOCKING findings from any reviewer) or a CLAUDE.md carve-out fires. For the review loop, a clean pass or a `CLAUDE.md` halt is the only end; for the run, the usage limit is.
  - Re-raised point: fix it, or, if it is non-security and already handled, cite the evidence in the next brief. Never a reason to stop.
  - A security finding clears only on a code change that a fresh reviewer passes, never on your own reply.
  - A confirmed secret exposure or auth bypass, in the diff or found mid-run, halts the run: print the file, line and secret type with no characters of the value, push nothing more (a fix commit does not remove a secret from history), post no marker, merge nothing, name the secret for Alexander to rotate.
  - The other halts are the first three sub-bullets of the halt bullet at the top of `CLAUDE.md` Process (value, spend, destructive), most often a value only Alexander holds (a prod secret, a third-party dashboard setting). In an interactive run ask Alexander for that one thing in the chat and keep shipping behind a safe default if one exists until he answers; with no default, hold this PR as draft and continue with other items. For a value only he holds, an unattended run (`/overnight-prs`) ships behind a safe default if one exists, otherwise leaves the PR draft and names the value in the morning summary, as step 1 does; a price, payment or Stripe value, a payment card, or a third-party bump decision never ships behind a default, it stays draft and is named in the summary. Spend and destructive halts never ship behind a default: spend leaves the PR draft, a destructive step is not executed, and both are named in the summary. An auth, JWT, webhook or signing secret never gets a default either: a missing one fails closed at boot and the PR stays draft with the variable named.
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

## 4. Merge

The merge queue on `main` was switched off on 2026-10-15 (ruleset `main merge queue`, enforcement `disabled`): it rebuilt `main` + the PR and re-ran the same required workflows that had just passed on the head SHA, about seven minutes per PR with nothing new learned. Classic branch protection still gates the merge on green required checks, and this flow has already rebased on `origin/main` and waited for the rollup, so `gh pr merge` merges directly.

```bash
gh pr merge <n> --repo 2anki/server --squash
```

The `check-merge-status.py`, `check-browser-attestation.py`, and `check-changelog-on-merge.py` hooks re-verify everything before the merge. A deny prints the reason — act on it, never bypass.

Then read the merge SHA:

```bash
gh api graphql -f query='{ repository(owner:"2anki", name:"2anki.net") { pullRequest(number:<n>) { state mergeCommit { oid } } } }'
```

- `state: MERGED` → record `MERGE_SHA` from `mergeCommit.oid` and continue.
- `state: OPEN` → the merge was refused (a required check went red between the rollup read and the merge, or `main` moved and `strict` protection wants a rebase). Read `gh pr view <n> --json mergeStateStatus,statusCheckRollup`, fix on the branch or rebase, and restart from step 1. A red check whose failure is unrelated to the diff (a timeout, a cancelled or crashed runner, a step that died before any test ran) gets exactly one rerun, `gh run rerun <run-id> --failed`, and a wait on the rollup; the `<run-id>` is the workflow run, read from the check's `detailsUrl` (`/actions/runs/<run-id>/job/<job-id>`), not the check or job id. A second red on the same job name for the same head SHA is treated as real and fixed on the branch, never rerun again. A failing test in a file the PR does not touch is not "unrelated" by itself: `.claude/rules/testing.md` exists because the #3908 regression lived in a distant suite, so read the failure before deciding. When the failing job is infrastructure the branch cannot change (a runner outage, a GitHub incident), convert it to draft (`gh pr ready --undo`, since a ready PR with red checks is a merge invitation), note the run URL on it, pause this PR on a `ScheduleWakeup` of 1200s and resume this same step; when the rollup is green again, `gh pr ready` and merge. The ship does not end, and other items proceed while this PR waits.
- `state: CLOSED` → someone closed the PR without merging; `gh api repos/2anki/2anki.net/issues/<n>/events --jq '[.[] | select(.event=="closed") | .actor.login] | last'` says who. An agent never reopens it: a close is a decision. Post nothing, delete nothing, record the outcome as `closed without merge` with the closer named, and move to the next item; if the branch work is still wanted, Alexander reopens it or asks for a new PR.

Never delete the branch by hand before `state: MERGED` is confirmed.

## 5. Watch the deploy

A merge whose diff is only `*.md` files triggers no deploy (`paths-ignore: '**.md'`) — go to step 7 (local cleanup still applies; it'll report `no deploy` from there).

```bash
gh run list --repo 2anki/server --workflow deploy.2anki.net.yml --branch main --limit 5 --json databaseId,headSha,status,conclusion
```

Find the run whose `headSha` is `$MERGE_SHA` (it appears within ~30s of the merge; `ScheduleWakeup` 60s if not yet listed). Then `gh run watch <id> --exit-status` — deploys take 6–10 minutes; prefer `ScheduleWakeup` 270s or a `Monitor` over holding the shell.

## 6. Verify prod

```bash
curl -fsS https://2anki.net/api/version | jq -r .sha
```

Must equal `$MERGE_SHA`. Then run `/deploy-status` (read-only SSH; this is the one sanctioned exception to "never touch the prod host"). Verdict "deploy healthy" → step 6b for a rail PR, step 7 otherwise. Verdict "watching X" → re-run `/deploy-status` after a `ScheduleWakeup` of 270s, reporting the evidence each round; the loop ends only at healthy or broken, never report healthy while watching; the run continues with other items meanwhile, this holds only this PR's deploy verdict. A failed deploy run is "watching" only once its log confirms the last-good restore ran; otherwise it is "broken" (the 2026-08-06 shape: live process up, poisoned disk). Verdict "broken" → step 8.

## 6b. Rail verification after deploy (only when step 1 hit)

- Migration: read-only prod psql (`PGOPTIONS="-c default_transaction_read_only=on"`) confirms the `knex_migrations` row and the new schema; pm2 logs show no query errors since the deploy.
- Stripe or webhooks: Stripe MCP shows webhook deliveries since the deploy succeeding (no new 4xx/5xx); pm2 logs show no Stripe errors; a checkout session can still be created if checkout changed.
- Auth: pm2 logs show successful logins since the deploy and no spike in 401/500 on auth routes.

Watch for 15 minutes after the deploy. Any regression → step 8 revert.

## 7. Local cleanup

Runs on the success path only (healthy deploy, or a merge with no deploy) — skip if you're headed to step 8 instead. "Merge" here means `state: MERGED` from step 4; the branch only exists to delete once that's confirmed.

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

Trio calls stay in the PR body under `## Decisions`; Alexander overrides one by commenting on the merged PR or opening a follow-up. If the PR leaves a step only Alexander can do (a prod secret, a Stripe dashboard setting, confirming on a specific account), ask Alexander for it in the chat; an unattended run names it in the morning summary instead. Do not open a `Needs you` issue. Do not create a daily `Shipped <date>` digest issue: those were dropped 2026-09-08 because they duplicated the merged-PR list and added an issue a day to close.
