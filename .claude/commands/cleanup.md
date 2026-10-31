---
description: Prune merged/superseded local branches, audit done specs, clear dead worktrees
allowed-tools: Bash
---

Post-wave housekeeping for the local checkout and `Documentation/specs/`. The hard part is **knowing what's safe to delete** — a branch tip whose subject reads "preserve interrupted work" can still be a zombie whose real fix shipped under a different branch. Verify before deleting; never `git branch -D` on a hunch.

Run from the repo root. Start by syncing refs:

```bash
git fetch --prune origin
```

## 1. Branches — verify, then delete

For every local branch except `main`, decide keep-or-delete:

```bash
for b in $(git branch --format='%(refname:short)' | grep -vx main); do
  tip=$(git rev-parse "$b")
  if git merge-base --is-ancestor "$tip" origin/main; then
    echo "MERGED   $b"
  else
    echo "UNMERGED $b  ($(git log -1 --format='%h %s' "$b" | cut -c1-72))"
  fi
done
```

- **MERGED** (tip is an ancestor of `origin/main`): safe — delete.
- **UNMERGED**: do **not** assume it's live work. The `worktree-agent-*` and `fix/issue-*` branches that survive a worktree teardown often carry a stale "preserve interrupted work" commit whose actual fix already merged under a different branch. Confirm before deleting: search for a merged PR covering the same issue or feature —

  ```bash
  gh pr list --state all --search "<issue-number-or-keywords>" --limit 5 \
    --json number,title,state,headRefName
  ```

  If a `MERGED` PR covers it, the local branch is a zombie → delete. If nothing covers it and the diff holds unique work, **keep it and report it** — don't delete unmerged work you can't account for. Also keep any branch with an **open** PR you authored.

Delete the confirmed-safe set with explicit names (never a blanket pattern on an unverified list):

```bash
git branch -D <branch> [<branch> ...]
```

Report, per deleted branch, which merged PR superseded it (`#NNNN`). That's the audit trail.

## 2. Specs — remove implemented ones

The spec lifecycle says the implementing PR should `git rm` its spec; in practice they leak onto `main`. Find any spec whose implementation already shipped:

```bash
git ls-tree -r --name-only origin/main -- Documentation/specs/
```

For each file, check whether its feature merged (`gh pr list --state all --search "<slug>" --json number,state,title`). If `MERGED`, ship a single removal:

```bash
git checkout -b chore/remove-implemented-specs -q
git rm Documentation/specs/<slug>.md   # repeat for each zombie
git commit -m "chore: remove implemented spec(s) for <feature>"
git push -u origin chore/remove-implemented-specs --no-verify   # pre-push hook false-positives on a new branch's first push
gh pr create --title "chore: remove implemented spec(s) for <feature>" --body "..."
```

In the PR body: no changelog entry (internal), and `Browser check: not applicable — removes a Documentation file, no web/src/ change`. Leave specs whose PR is still open or in flight.

> Reference docs under `Documentation/ops-observability/` (e.g. `SPEC.md`, `STRIPE_SPEC.md`) are **not** lifecycle specs — they live outside `Documentation/specs/` and stay.

## 3. Worktrees and refs

```bash
git worktree list          # anything other than the main checkout?
git worktree remove <path> # for each stale one (git worktree prune if the dir is already gone)
```

`git fetch --prune` (step 0) already dropped stale remote-tracking refs.

## Report

End with: branches deleted (and the PR that superseded each), specs removed (and the PR opened to do it), worktrees cleared, and anything **kept** because it held unaccounted-for unmerged work.
