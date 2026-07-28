---
description: Take a spec and ship it - take over the draft spec PR, code, tests, mark ready
argument-hint: spec PR number or URL (preferred), or paste the spec / path to a spec file
---

Use the `engineer` agent.

## Primary path — take over the draft spec PR

When `$ARGUMENTS` is a PR number or URL (or you can find a draft PR titled `spec: …` for the spec at hand), graduate that PR to implementation rather than creating a new branch:

1. Fetch the PR (`gh pr view <n> --json title,headRefName,isDraft,body`) and check out its branch locally:
   ```
   gh pr checkout <n>
   ```
   The branch should already be `feat/spec-<slug>` / `fix/spec-<slug>` / `refactor/spec-<slug>` etc. (the spec author picked the prefix to match the implementation). If it is still on the legacy `docs/spec-<slug>` shape, rename the local branch and update the PR head before pushing more commits:
   ```
   git branch -m feat/spec-<slug>
   git push origin -u feat/spec-<slug>
   gh pr edit <n> --head feat/spec-<slug>
   ```
2. Read the spec at `Documentation/specs/<slug>.md` (it is the source of truth — do not re-derive scope).
3. Follow the engineer workflow in `.claude/agents/engineer.md`:
   - Restate the change in one sentence.
   - Trace the code path (list files, name the layer).
   - Plan the diff.
   - Write the failing test first (TDD per CLAUDE.md).
   - Implement (smallest viable change, no comments — meaningful names instead).
4. Commit in logical chunks on the existing branch using conventional-commit messages.
5. Before the final push, remove the spec file — its text lives in the original `docs: add spec for …` commit on this branch and in the deletion diff:
   ```
   git rm Documentation/specs/<slug>.md
   git commit -m "chore: remove implemented spec for <feature name>" \
     -m "Spec text preserved in git history: git log -p -- Documentation/specs/<slug>.md"
   ```
6. **Add a changelog entry if this PR changes user-visible behavior.** See CLAUDE.md > Changelog for the rules (file path, when to add, voice). One line, user-facing prose — no implementation details. If you can't write the entry without referencing internal code, the PR probably doesn't need one. Commit as `chore: add changelog entry for <feature>`.
7. **Update user docs if this PR adds or changes a user-visible feature.** User docs live at `web/src/pages/DocsPage/content/` (rendered in-app at 2anki.net/docs). Add a new MDX file or update an existing one whenever you ship: a new input format, a new converter capability, a changed flow the existing docs already describe, or a new account-level feature. The trigger is stricter than the changelog rule — skip when: pure bug fix (the docs were already correct), internal refactor, copy-only tweak, or a change so small a user would never look it up. Follow VOICE.md for prose; sentence-case headings; no implementation details. If you add a new MDX page, register it in `web/src/pages/DocsPage/sidebar.ts` so it shows up in navigation. Commit as `docs: update user docs for <feature>`.
8. Run `/check` (parallel tsc + web typecheck + web vitest + web lint). All green before flipping the PR.
8b. **If the PR is user-facing, run the `designer` review NOW — before flipping ready — and commit any must-fix it returns.** Designer validates UX *before* the PR ships, per the trio policy; do not defer it to the pre-merge checklist below. A must-fix found *after* `gh pr ready` can race a merge — Alexander may merge a ready PR before the follow-up lands (this happened with #3446: the silent-no-op gating fix raced the merge and had to ship as a separate follow-up #3447). The PR is not ready until designer-clean.
9. Graduate the PR from draft to ready, and rename the title to match the implementation prefix:
   ```
   gh pr edit <n> --title "<type>: <feature name>"   # feat: / fix: / refactor: / ...
   gh pr ready <n>
   ```
   Update the PR body to the engineer template in `.claude/agents/engineer.md` (What / Why / How / Measuring success / Testing / Risks / Goal alignment). Keep the link to the trio synthesis if it was useful.
   **Flip ready only when every CI check on the branch is COMPLETED and green** (`gh pr view <n> --json statusCheckRollup`) — a ready PR with a check still running can meet a "merge if ready" while secretly red (#3908). If the spec came from a GitHub issue, the PR body carries `Closes #<issue>` so the merge auto-closes it.
10. **Print the PR link.** Once the PR is ready, end your reply with the full `https://github.com/2anki/server/pull/<n>` URL as the last line so Alexander can click straight through.

Before merging:
- All checks green.
- Changelog entry added if the PR is user-visible (or explicit note in the PR body that no entry is warranted).
- User docs updated if the PR adds or changes a user-visible feature (or explicit note in the PR body that none are needed).
- Designer review is done pre-ready (step 8b), not here. Re-ping the `designer` agent only if the diff changed materially after flipping ready.
- If the change touches auth, payments, or external-API integration, run `/security-review` first.
- Note goal alignment in the PR body (per `CLAUDE.md`).

## Fallback — no draft spec PR exists

If `$ARGUMENTS` is a raw spec (pasted body or a path to a `.md` file with no associated draft PR):

1. Read the spec.
2. Follow the engineer workflow above.
3. Suggest a branch name. Format: `<type>/<short-slug>` using a conventional commit prefix (`fix/`, `feat/`, `chore/`, `refactor/`, `test/`). Do **not** use `docs/` for an implementation branch.
4. Once confirmed, create the branch, commit in logical chunks. If the work changes user-visible behavior, add a changelog entry per CLAUDE.md > Changelog (separate `chore: add changelog entry …` commit). If the work adds or changes a user-visible feature (stricter than the changelog trigger — see step 7 of the primary path), also update the in-app user docs under `web/src/pages/DocsPage/content/` and register any new MDX page in `web/src/pages/DocsPage/sidebar.ts`, in a separate `docs: update user docs …` commit. Run `/check`, then open the PR (not draft) with `gh pr create` using the engineer template. End your reply with the full `https://github.com/2anki/server/pull/<n>` URL as the last line.

In this path there is no spec file in the repo to remove — skip the spec-cleanup commit.

---

$ARGUMENTS
