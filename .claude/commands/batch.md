---
description: Dispatch N parallel worker agents to clear a queue of independent mechanical tasks
argument-hint: <task-type> [--patch-only] [--dry-run]
---

You are the dispatcher for `/batch`. The queue is the input; your job is to fan out independent mechanical work, drain it, and report a single table back. You never edit files yourself — every change goes through a forked worker in its own worktree.

Pilot scope is the `dependabot` task type. `dead-code` and `copy-sweep` are deferred — if the caller passes them, refuse with: `task-type not yet implemented — pilot is dependabot only`.

## Constants

- `MAX_TASKS = 20`
- `MAX_CONCURRENT = 4`
- `TIMEOUT_PER_TASK = 10 min`
- `HARD_BLOCK_PATHS` — a flag, not a block: entries touching these paths still dispatch, with `/security-review` first. Any change touching:
  - `src/services/StripeService/**`
  - `src/services/AuthenticationService/**`
  - `src/lib/Token.ts`
  - anything matching `auth` or `payments` in the diff path
  Dispatch them too: the worker runs `/security-review` on the diff, and `/ship` adds its own fresh read-only reviewers before the marker.

## Step 1 — pre-check

Check whether the orchestrator's main checkout is dirty:

```
git status --porcelain
```

If the output is non-empty, print `Orchestrator checkout has uncommitted changes — dispatching from a fresh worktree off origin/main instead.`, create that worktree with `git worktree add .claude/worktrees/batch-<timestamp> origin/main`, and dispatch from it. Never stash, reset, checkout or clean the dirty root; those changes belong to another session.

## Step 2 — parse arguments

The argument string is `$ARGUMENTS`. Parse:

- The first positional token is `<task-type>`. For the pilot, only `dependabot` is wired up — anything else (including `dead-code` and `copy-sweep`) exits with `task-type not yet implemented — pilot is dependabot only`.
- `--patch-only` — for `dependabot`, filter out minor and major bumps before dispatch.
- `--dry-run` — list what would dispatch; do **not** `EnterWorktree`, do **not** fork agents, do **not** create PRs. Print the plan as a table and exit.

## Step 3 — plan phase

Build the task list for the requested type.

### `dependabot`

```
gh pr list --author "app/dependabot" --state open --json number,title,labels,headRefName,files --limit 50
```

For each PR:

1. Read the title. Dependabot encodes the bump level there — extract `patch | minor | major` from the conventional `bump <pkg> from X to Y` shape plus the semver delta. If you cannot determine the bump level, mark it `unknown` and treat as non-patch.
2. If `--patch-only` is set, drop entries whose bump level is not `patch`.
3. Pull the file list (`files[].path`). If any path matches `HARD_BLOCK_PATHS`, keep the entry in the dispatch list, mark it `hard-blocked` so the worker runs `/security-review` on the diff first, and list it separately in the final report.

Cap the result at `MAX_TASKS`. Alexander typing `/batch` himself is the approval for up to `MAX_TASKS` agent runs; an agent never invokes `/batch` to create that approval. If the raw queue had more than `MAX_TASKS` viable entries, print `Queue has <N> tasks; cap is 20. Dispatching the first 20; the remaining <N-20> stay in the queue for the next /batch.` and continue; nothing is dropped, the leftovers are still open on GitHub.

## Step 4 — dispatch loop

If `--dry-run`, print the table from step 6 with status `would-dispatch` for every viable task and `would-dispatch (hard-blocked: security-review first)` for marked entries, then exit.

Otherwise:

- Maintain a worktree-ID set. Every `EnterWorktree` call gets tracked here.
- Maintain a pending queue, an in-flight set, and a completed list.
- While pending is non-empty OR in-flight is non-empty:
  - While `len(in-flight) < MAX_CONCURRENT` and pending is non-empty:
    - Pop the next task.
    - `EnterWorktree` off `origin/main` — record the returned worktree ID.
    - Fork a worker with the matching template: `.claude/commands/batch-tasks/<task-type>.md`. Pass the worker the PR number (or task-specific input) and the worktree path.
    - Invoke the worker with `isolation: "worktree"` and `run_in_background: true`. Record its task ID alongside the worktree ID.
  - Wait for the next worker to finish (do not busy-poll — use the agent completion notification).
  - When a worker returns, print one line: `<pr#> <branch> → <status>`. Move it from in-flight to completed.
  - If a worker has been in-flight longer than `TIMEOUT_PER_TASK`, kill it via `TaskStop` and record status `timeout`; this per-task cap ends that task only, and the loop continues with the next.

## Step 5 — cleanup

Run cleanup in a deferred pass that fires on success **and** on any failure path (early return, exception, user cancel):

```
for each tracked worktree_id:
    ExitWorktree(worktree_id)
```

Never leave a worktree behind. If `ExitWorktree` itself errors, log the worktree ID and continue — the human can prune manually.

## Step 6 — report

Print one final markdown table:

```
| task | branch | PR# | status |
| --- | --- | --- | --- |
| bump foo from 1.2.3 to 1.2.4 | dependabot/npm_and_yarn/foo-1.2.4 | 2301 | merged |
| bump bar from 2.0.0 to 3.0.0 | dependabot/npm_and_yarn/bar-3.0.0 | 2302 | needs-review |
| bump baz from 4.1.0 to 4.1.1 | dependabot/npm_and_yarn/baz-4.1.1 | 2303 | failed-checks |
| bump qux from 5.0.0 to 5.0.1 | dependabot/npm_and_yarn/qux-5.0.1 | 2304 | timeout |
```

Row statuses are exactly: `merged | open | needs-review | failed-checks | timeout`. (`would-dispatch` appears only in `--dry-run` output, and `hard-blocked` is a flag on a row, not a status.)

Below the table, one summary line:

```
N merged · N needs-review · N failed-checks · N timeout · N hard-blocked (security-reviewed before /ship)
```

If `hard-blocked` is non-empty, list those PR numbers with the `/security-review` verdict each one shipped on.

## Step 7 — exit

Exit 0 if every dispatched task ended in `merged` or `needs-review`. Exit 1 if any task ended in `failed-checks` or `timeout` — those are dispatcher-visible failures worth a non-zero exit.

## Notes

- The dispatcher does not read or edit code in the repo. It reads `gh pr` metadata, dispatches workers, and prints a table. If you find yourself running `gh pr diff` or reading source files, stop — that is the worker's job.
- The dispatcher does not call `gh pr merge`. Only the worker merges, and only under the worker's own rules.
- Never widen `HARD_BLOCK_PATHS` silently. Adding a path is a separate PR to this file.
- The worker template is the contract — if you change inputs or outputs here, update `.claude/commands/batch-tasks/dependabot.md` in the same PR.
