---
description: Verify and ship one Dependabot PR
---

You are one worker fork dispatched by `/batch dependabot`. You own one worktree and one Dependabot PR. Your job is to verify the PR and ship it, or stop with a clear status. You do not coordinate with sibling workers.

## Inputs

The dispatcher passes:

- A single Dependabot PR number — call it `<n>`.
- A worktree path — your isolated checkout of `origin/main`. All your shell work happens here.

## Step 1 — read the PR

```
gh pr view <n> --json title,body,labels,headRefName,files,statusCheckRollup
```

From the JSON:

- **Title** — Dependabot encodes the bump level here. Parse the semver delta from the `bump <pkg> from X.Y.Z to A.B.C` shape:
  - `X == A && Y == B` → `patch`
  - `X == A && Y != B` → `minor`
  - `X != A` → `major`
  - If you cannot parse, treat as `unknown` and proceed as non-patch.
- **Files** — list of changed paths.
- **Labels** — surface any `security` label.

## Step 2 — belt-and-suspenders needs-eyes check

Even though the dispatcher filtered, re-check the PR against the full needs-eyes set before considering a merge. A PR is **needs-eyes** if ANY of the following apply (hold, route or wait).

### 2a — hard-block paths (security-review)

Re-check the file list against the hard-block set from `.claude/commands/batch.md`:

- `src/services/StripeService/**`
- `src/services/AuthenticationService/**`
- `src/lib/Token.ts`
- any path matching `auth` or `payments`

If any file matches, run `/security-review` on the diff and the full server suite, and put both results in the `/ship` review brief so its fresh reviewers check them. Clean → `/ship <n>`. A finding in the bumped package → comment it and return `needs-review`: the fix lives upstream, so this is the "value only Alexander holds" carve-out (whether to take the bump at all). A finding clearly in our own code → carry the bump plus the fix on a branch of ours off `main`, `/ship` that, and comment the link on the bot PR; Dependabot closes its own PR once the bump is on `main` (the bot owns its branch, nobody pushes to it and nobody closes it by hand); the bot PR returns status `needs-review` until then. When it is not clear which, treat it as the package's.

### 2b — dependency-rules hold/route/wait checks (`.claude/rules/dependencies.md`)

Inspect the bumped package (from the title) and the file list. Each bullet names its action: a hold (comment + `needs-review`) is the "whether to take this bump" carve-out in `CLAUDE.md` Process; a route adds a check before `/ship`; a wait pauses on a wakeup:

- **Pinned override** — Hold: touches any key under `pnpm.overrides` in `package.json` (read the file, the list changes). Bumping these can silently re-open a CVE we've worked around.
- **Built dependency** — touches anything in `pnpm.onlyBuiltDependencies` (currently `better-sqlite3`). Hold: an install-time build script is a supply-chain surface, the "whether to take this bump" carve-out; comment with the bump level and the changelog link and return `needs-review`.
- **Security-sensitive surface** — touches `bcryptjs`, `jsonwebtoken`, `sanitize-html`, `multer`, `express`, `stripe`, `@notionhq/client`, `@anthropic-ai/sdk`, `@sendgrid/mail`, `axios`, `knex`, or anything matching `node-*`. Hold: even minors here are the "whether to take this bump" carve-out, because `hard_rails.py` has no `package.json` trigger and `/ship`'s rail verification would not run on them. Comment with the bump level and the changelog link and return `needs-review`.
- **Held bump** — the package appears under "Held bumps" in `.claude/rules/dependencies.md` — that list is the only source of held-version bumps (it reads "None at the moment" today); pinned overrides are the separate bullet above. Comment with the hold reason and return `needs-review` (a flagged third-party bump, the CLAUDE.md carve-out); do not re-litigate the hold.
- **Stale or skipped CI** — Wait: any `test`-named check in `statusCheckRollup` is SKIPPED/CANCELLED, or the PR's checks predate a `.github/workflows/` change on main. Comment `@dependabot rebase`, `ScheduleWakeup` 1200s, re-read the rollup and continue; keep waiting on the wakeup until the test check has run (the dispatcher moves to the next PR meanwhile; this holds one PR, not the run) — never merge on a rollup whose test job didn't run (the 2026-08-06 outage shipped exactly this way).

For any 2b hold, comment with the reason and a changelog link so the next reviewer can decide in 30 seconds, then exit `needs-review`:

```
gh pr comment <n> --body "Held for manual review (<reason>) · bump: <patch|minor|major>. Changelog: <url>"
```

The changelog URL is usually in the PR body under "Release notes" or "Commits" — extract the GitHub release link if present, otherwise the dep's releases page.

## Step 3 — check out the PR in your worktree

```
gh pr checkout <n>
```

## Step 4 — run /check AND the server suite

Invoke the `/check` skill — the existing parallel server tsc + `arch` + web typecheck + web vitest + web lint pipeline. Then run the full server vitest suite: `pnpm test`. A dependency bump is the second case, after the shared parser or exporter list, where both full suites run locally (`.claude/rules/dependencies.md`). **`/check` does not run the server suite**, and tsc cannot see a runtime API removal inside an untyped JS dependency — the 2026-08-06 markdown-it 15 outage passed typecheck and died at module load, which `pnpm test` catches instantly (any suite importing the broken module fails at import). Capture overall pass/fail across both; the documented environmental failures (`getPageCount` pdfinfo, `PythonExitError` in venv-less worktrees) don't count as red. If anything else failed, mark the run as failed and record the first failing summary line for the comment.

## Step 5 — decide

Decision matrix:

| bump | /check | security label | action |
| --- | --- | --- | --- |
| patch | green | none | `/ship <n>` → status `merged` |
| patch | red | any | read the failed log; a flake unrelated to the diff → `gh run rerun` once and re-evaluate (a second red is not a flake); our code failing against a documented API change → carry the bump plus the fix on a branch of ours off `main`, `/ship` that, and comment the link on the bot PR; Dependabot closes its own PR once the bump is on `main` (the bot owns its branch, nobody pushes to it and nobody closes it by hand); the bot PR returns status `needs-review` until then; the package itself broken → comment what broke → status `needs-review` (a failing third-party bump, the CLAUDE.md carve-out) |
| patch | green | security | comment "Security-flagged — needs eyes" → status `needs-review` (the "whether to take this bump" carve-out: an advisory can land on an unlisted transitive package, and `hard_rails.py` has no `package.json` trigger) |
| minor | green | none | full server suite locally green, then `/ship <n>` → status `merged` |
| minor | red | any | same as patch + red |
| minor | green | security | comment "Security-flagged — needs eyes" → status `needs-review` (the "whether to take this bump" carve-out: an advisory can land on an unlisted transitive package, and `hard_rails.py` has no `package.json` trigger) |
| major | green | none | the `dependencies.md` major-bump checks (changelog for removed APIs, full server suite locally green, plugin grep, a sanity run of the conversion path), with the local suite output attached to the `/ship` review brief so its fresh reviewers confirm them, then `/ship <n>` → status `merged`; our code breaking against a documented API change → carry the bump plus the fix on a branch of ours off `main`, `/ship` that, and comment the link on the bot PR; Dependabot closes its own PR once the bump is on `main` (the bot owns its branch, nobody pushes to it and nobody closes it by hand); the bot PR returns status `needs-review` until then; the package itself broken → comment what broke → status `needs-review` (carve-out) |
| major | red | any | same as patch + red |
| major | green | security | comment "Security-flagged — needs eyes" → status `needs-review` (the "whether to take this bump" carve-out: an advisory can land on an unlisted transitive package, and `hard_rails.py` has no `package.json` trigger) |
| unknown | any | any | comment "Could not parse bump level from title" → status `needs-review` |

**Merge call:**

```
/ship <n>
```

Only ever from a `green` row whose listed checks and reviews passed, and only when Step 2 raised no hold. Never from a red row to merge the bot PR; a red row's `/ship` targets our own carry branch only. A `/ship` that ends without `state: MERGED` maps to `needs-review` only when one of the four `CLAUDE.md` Process halts ended it. A revert is `/ship` step 8, not a halt: log the revert PR and resume the ship after the fix. Any other non-merged state means `/ship` is still running, so resume it per `ship.md` step 4.

**Comment call (any `needs-review` exit):**

```
gh pr comment <n> --body "<one-line reason> · /check: <pass|fail summary> · bump: <patch|minor|major|unknown>"
```

Keep the comment short and specific — no padding, no fake warmth.

## Step 6 — fail-safe

Wrap the whole run. On any unexpected error (timeout from `/check`, `gh` non-zero exit, parse failure on the JSON, missing worktree, etc.):

```
gh pr comment <n> --body "Batch worker failed: <error type> · <one-line context>"
```

Exit with status `failed-checks`. Never silently fail; never exit without reporting something to the dispatcher.

## Step 7 — return

Return one of these exact status strings to the dispatcher:

- `merged`
- `needs-review`
- `failed-checks`

(`open` and `timeout` are dispatcher-side statuses; you never produce them.)

Include the PR number and the head branch name in your return payload so the dispatcher can render its table.

## Rules

- **Never** bypass the queue with `gh pr merge --admin`. The `check-merge-status.py` hook is the gate.
- **Never** rebase or push to the Dependabot branch yourself — comment `@dependabot rebase` if needed; the bot owns the branch.
- **Never** close a held PR without merging. The Dependabot workflow expects merge or label, not close (`.claude/rules/dependencies.md`).
- **Do not** read or edit `pnpm-lock.yaml` directly. If a major needs lockfile attention, comment `@dependabot rebase` (the bot owns the branch), wait on a `ScheduleWakeup` of 1200s, and continue; never edit the lockfile by hand.

## When held majors pile up

This worker handles one PR, but if the dispatcher reports five or more held PRs accumulating across a run, record the list in the run summary with the upgrade impact (transitive bloat via `pnpm why`, breaking-change notes from the changelog); held PRs stay held, and majors keep going through the matrix above.
