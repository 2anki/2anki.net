---
description: Merge and deploy a finished PR unattended — review agent → gate → merge → watch deploy → verify prod → digest
argument-hint: <PR number or URL>
allowed-tools: Bash, Read, Grep, Glob, Agent, Monitor, ScheduleWakeup
---

You are shipping PR `$ARGUMENTS`. This is the **only** path an agent uses to run `gh pr merge`. Never call it outside this flow, never try to bypass the hook (a `CLAUDE_SKIP_SAFETY=1` prefix is ignored by design), never weaken a hook to get through — if the gate blocks, the fix goes on the branch. Reference: `.claude/docs/autonomous-shipping.md`.

## 1. Preflight

```bash
gh pr view <n> --repo 2anki/server --json number,isDraft,files,headRefName,headRefOid,body,author,statusCheckRollup
```

- Draft → stop; report "still draft".
- Hard rail? Run the rail check on the file list and diff:
  ```bash
  gh pr view <n> --json files --jq '.files[].path' > /tmp/ship-paths.txt
  gh pr diff <n> > /tmp/ship-diff.txt
  python3 -c "import sys; sys.path.insert(0,'.claude/hooks'); import hard_rails as r; p=open('/tmp/ship-paths.txt').read().split(); print(r.rail_paths(p)); print(r.rail_content_hits(open('/tmp/ship-diff.txt').read()))"
  ```
  Any hit → **rail flow**: run step 2 (review agent, post the marker), make sure the PR is ready (`gh pr ready <n>`), print the PR URL, and stop. Alexander merges rail PRs from the GitHub UI. Do not continue to step 4.
- Bring the branch up to date: `gh pr checkout <n>`, `git fetch origin main`, `git rebase origin/main`. If the rebase moved HEAD, `git push --force-with-lease origin <branch>` and re-read `headRefOid`.

## 2. Review agent

Run the `/review-pr` fan-out on `<n>` (security / engineering / ux-voice forks, fresh context, diff only). Read the synthesized verdict:

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

Then wait for SonarCloud on the head SHA (polls up to five minutes, exits non-zero if the gate fails or Sonar is unreachable):

```bash
python3 .claude/hooks/sonar_gate.py --pr <n> --sha "$HEAD" --wait 300
```

Open findings → fix on the branch, restart from step 1.

## 4. Merge

```bash
gh pr merge <n> --repo 2anki/server --squash --delete-branch
```

The `check-merge-status.py`, `check-browser-attestation.py`, and `check-changelog-on-merge.py` hooks re-verify everything. A deny prints the reason — act on it, never bypass. Record the merge SHA:

```bash
MERGE_SHA=$(gh pr view <n> --json mergeCommit --jq .mergeCommit.oid)
```

## 5. Watch the deploy

A merge whose diff is only `*.md` files triggers no deploy (`paths-ignore: '**.md'`) — report "merged, no deploy" and go to step 8.

```bash
gh run list --repo 2anki/server --workflow deploy.2anki.net.yml --branch main --limit 5 --json databaseId,headSha,status,conclusion
```

Find the run whose `headSha` is `$MERGE_SHA` (it appears within ~30s of the merge; `ScheduleWakeup` 60s if not yet listed). Then `gh run watch <id> --exit-status` — deploys take 6–10 minutes; prefer `ScheduleWakeup` 270s over holding the shell.

## 6. Verify prod

```bash
curl -fsS https://2anki.net/api/version | jq -r .sha
```

Must equal `$MERGE_SHA`. Then run `/deploy-status` (read-only SSH; this is the one sanctioned exception to "never touch the prod host"). Verdict "deploy healthy" → step 8.

## 7. Failure → revert

If the deploy run failed, `/api/version` does not report the merge SHA after the run finished, or `/deploy-status` says "broken":

1. `git checkout main && git pull --ff-only && git checkout -b revert/<slug>`
2. `git revert --no-commit $MERGE_SHA && git commit -m "revert: <original subject>" -m "Deploy run <run URL> failed after merging #<n>: <one line on what broke>."` — git's default `Revert "…"` subject fails the conventional-prefix hook, so write the subject yourself (≤72 chars).
3. `git push -u origin revert/<slug>` and `gh pr create --repo 2anki/server --base main --head revert/<slug>` with a body that links the failed run and the original PR.
4. Ship the revert through this command. A pure `git revert` of the PR just merged skips step 2's review agent: post the marker directly with the verdict "mechanical revert of #<n> after a failed deploy". CI, Sonar, and the hooks still gate it.
5. Comment the revert PR URL on the deploy-failure issue the workflow opened (`gh issue list --search "Production deploy failed" --state open`).
6. Reopen the original issue if the PR had closed one, with one line on what failed.

## 8. Digest

Find or create today's digest issue and append one comment:

```bash
TODAY=$(date -u +%Y-%m-%d)
ISSUE=$(gh issue list --repo 2anki/server --label shipped-digest --state open --search "\"Shipped $TODAY\" in:title" --json number --jq '.[0].number // empty')
if [ -z "$ISSUE" ]; then
  URL=$(gh issue create --repo 2anki/server --title "Shipped $TODAY" --label shipped-digest --body "Everything agents merged and deployed today. One comment per PR; override any decision by replying or opening a follow-up.")
  ISSUE=${URL##*/}
fi
gh issue comment "$ISSUE" --repo 2anki/server --body-file /tmp/ship-digest.md
```

`/tmp/ship-digest.md` shape:

```
### <PR title> — https://github.com/2anki/server/pull/<n>
<one line: what changed and why>
<the PR body's `## Decisions` block verbatim, if present>
Deploy: <merge sha short> · <"healthy" | "no deploy (docs only)" | "reverted via #<m>">
```

`gh issue create` prints the new issue's URL, hence `${URL##*/}` for the number. The `shipped-digest` label exists (created 2026-08-26); if it ever goes missing, `--label` errors — recreate it with `gh label create shipped-digest --repo 2anki/server --color 0E8A16 --description "Daily digest of agent-merged PRs"`.

## Report

End with two lines: the PR URL, and the deploy verdict (`healthy <sha>` / `no deploy` / `reverted → <revert PR URL>` / `rail — waiting for Alexander`).
