# Spec lifecycle

Moved out of the root `CLAUDE.md` (2026-08-25); loads on demand before `/spec-draft-pr` or `/implement`.

Specs live in `Documentation/specs/` only while a feature is in flight. Workflow:

1. `/spec-draft-pr` writes the spec and opens a **draft** PR on a branch named after the eventual commit type — `feat/spec-<slug>`, `fix/spec-<slug>`, `refactor/spec-<slug>`, etc. Never `docs/spec-<slug>` — that branch can't graduate to `feat:`/`fix:` cleanly.
2. `/implement` takes that same draft PR over: `gh pr checkout`, codes on the same branch, renames the PR title from `spec: …` to `<type>: …`, and runs `gh pr ready`.
3. Before the final push, `git rm Documentation/specs/<slug>.md` in a `chore: remove implemented spec for …` commit. The folder stays small.
   - **After squash-merge the spec text is NOT recoverable from main's history** — `git log -p -- Documentation/specs/<slug>.md` returns nothing (the squash nets the add+remove to zero). Recover it from the spec PR instead: `gh pr view <n> --json commits` for the docs-commit SHA, then `gh api "repos/2anki/server/contents/Documentation/specs/<slug>.md?ref=<sha>" --jq .content | base64 -d`. Don't cite the git-log path in issue bodies — several existing issues repeat that broken claim.

Do not open a separate implementation PR alongside a spec PR. Do not let `Documentation/specs/` collect specs for already-shipped work.
