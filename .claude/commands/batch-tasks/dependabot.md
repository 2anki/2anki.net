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

Even though the dispatcher filtered, re-check the PR against the full needs-eyes set before considering a merge. A PR is **needs-eyes** if ANY of the following hold.

### 2a — hard-block paths (security-review)

Re-check the file list against the hard-block set from `.claude/commands/batch.md`:

- `src/services/StripeService/**`
- `src/services/AuthenticationService/**`
- `src/lib/Token.ts`
- any path matching `auth` or `payments`

If any file matches, run `/security-review` on the diff and the full server suite, and put both results in the `/ship` review brief so its fresh reviewers check them. Clean → `/ship <n>`. Any finding → comment it and return `needs-review`: the fix lives upstream in the package, not on this branch, so this is the "value only Alexander holds" carve-out (whether to take the bump at all).

### 2b — dependency-rules hold checks (`.claude/rules/dependencies.md`)

Inspect the bumped package (from the title) and the file list. Hold — comment + `needs-review` — if ANY are true:

- **Pinned override** — touches a package listed in `pnpm.overrides` (`package.json`): `path-to-regexp`, `picomatch`, `rollup`, `yaml`, `@types/express`, `@types/express-serve-static-core`. Bumping these can silently re-open a CVE we've worked around.
- **Built dependency** — touches anything in `pnpm.onlyBuiltDependencies` (currently `better-sqlite3`). Build-step deps need a manual smoke run.
- **Security-sensitive surface** — touches `bcryptjs`, `jsonwebtoken`, `sanitize-html`, `multer`, `express`, `stripe`, `@notionhq/client`, `@anthropic-ai/sdk`, `@sendgrid/mail`, `axios`, `knex`, or anything matching `node-*`. Even minors here get a manual look, so the `security` matrix rows below never apply to these packages.
- **Held bump** — the package appears under "Held bumps" in `.claude/rules/dependencies.md` — that list is the only source of named-package holds (it reads "None at the moment" today). Comment with the hold reason and return `needs-review`; do not re-litigate the hold.
- **Stale or skipped CI** — any `test`-named check in `statusCheckRollup` is SKIPPED/CANCELLED, or the PR's checks predate a `.github/workflows/` change on main. Comment `@dependabot rebase`, exit `needs-review`, and re-evaluate on the next `/batch` — never merge on a rollup whose test job didn't run (the 2026-08-06 outage shipped exactly this way).

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

Invoke the `/check` skill — the existing parallel server tsc + web typecheck + web vitest + web lint pipeline. Then run the full server Jest suite: `pnpm test`. **`/check` does not run server Jest**, and tsc cannot see a runtime API removal inside an untyped JS dependency — the 2026-08-06 markdown-it 15 outage passed typecheck and died at module load, which `pnpm test` catches instantly (any suite importing the broken module fails at import). Capture overall pass/fail across both; the documented environmental failures (`getPageCount` pdfinfo, `PythonExitError` in venv-less worktrees) don't count as red. If anything else failed, mark the run as failed and record the first failing summary line for the comment.

## Step 5 — decide

Decision matrix:

| bump | /check | security label | action |
| --- | --- | --- | --- |
| patch | green | none | `/ship <n>` → status `merged` |
| patch | red | any | read the failed log; a flake unrelated to the diff → `gh run rerun` once and re-evaluate (a second red is not a flake); our code failing against a documented API change → adapt it on the branch, re-run `/check`, continue; the package itself broken → comment what broke → status `needs-review` (the fix is upstream) |
| patch | green | security | run `/security-review` on the diff; clean → `/ship <n>` → status `merged`; a finding → comment it → status `needs-review` |
| minor | green | none | full server suite locally green, then `/ship <n>` → status `merged` |
| minor | red | any | same as patch + red |
| minor | green | security | run `/security-review` on the diff; clean → `/ship <n>` → status `merged`; a finding → comment it → status `needs-review` |
| major | green | none | the `dependencies.md` major-bump checks (changelog for removed APIs, full server suite locally green, plugin grep, a sanity run of the conversion path), with the local suite output attached to the `/ship` review brief so its fresh reviewers confirm them, then `/ship <n>` → status `merged`; a breakage → comment what broke → status `needs-review` |
| major | red | any | same as patch + red |
| major | green | security | the major-bump checks plus `/security-review`; clean → `/ship <n>` → status `merged`; a finding → comment it → status `needs-review` |
| unknown | any | any | comment "Could not parse bump level from title" → status `needs-review` |

**Merge call:**

```
/ship <n>
```

Only ever from a `green` row whose listed checks and reviews passed, and only when Step 2 raised no hold. Never from a red row. A `/ship` that ends without `state: MERGED` (a revert, or a step only Alexander can do) maps to `failed-checks` when CI failed and `needs-review` otherwise.

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
- **Do not** read or edit `pnpm-lock.yaml` directly. If a held major needs lockfile attention, surface it in your `needs-review` comment for a manual `pnpm install`.

## When held majors pile up

This worker handles one PR, but if the dispatcher reports five or more held PRs accumulating across a run, surface the list to Al with the upgrade impact (transitive bloat via `pnpm why`, breaking-change notes from the changelog) so a batch decision can be made. Do not start auto-upgrading majors.
