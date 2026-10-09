# Spec lifecycle

Moved out of the root `CLAUDE.md` (2026-08-25); loads on demand before `/spec-draft-pr` or `/implement`.

Specs live in `Documentation/specs/` only while a feature is in flight. Workflow:

1. `/spec-draft-pr` writes the spec and opens a **draft** PR on a branch named after the eventual commit type — `feat/spec-<slug>`, `fix/spec-<slug>`, `refactor/spec-<slug>`, etc. Never `docs/spec-<slug>` — that branch can't graduate to `feat:`/`fix:` cleanly. The `<type>/spec-<slug>` shape is also the **machine signal that a PR came from a spec** (see below).
2. `/implement` takes that same draft PR over: `gh pr checkout`, codes on the same branch, renames the PR title from `spec: …` to `<type>: …`, and runs `gh pr ready`. Before any code lands it runs the **clarify pass**: every `[NEEDS CLARIFICATION: …]` marker the draft left in the spec is resolved into the spec first (`check-spec-format.py` blocks an implementation-phase commit that still carries one).
3. Before the final push, **archive the acceptance criteria, then remove the spec**:
   - Fold the spec's final acceptance criteria into the owning surface's `FEATURE.md` as a short `## Behavior` list (requirement + scenario, one line each) — the durable record is prose requirements, not criteria reverse-engineered from tests (OpenSpec `archive`). Commit as `docs: record <feature> behavior in FEATURE.md`.
   - `git rm Documentation/specs/<slug>.md` in a `chore: remove implemented spec for …` commit. The folder stays small.
   - **After squash-merge the spec text is NOT recoverable from main's history** — `git log -p -- Documentation/specs/<slug>.md` returns nothing (the squash nets the add+remove to zero). Recover it from the spec PR instead: `gh pr view <n> --json commits` for the docs-commit SHA, then `gh api "repos/2anki/server/contents/Documentation/specs/<slug>.md?ref=<sha>" --jq .content | base64 -d`. Don't cite the git-log path in issue bodies — several existing issues repeat that broken claim.

Do not open a separate implementation PR alongside a spec PR. Do not let `Documentation/specs/` collect specs for already-shipped work.

## Gates (added 2026-10-09, issue #4427)

- **Spec validator** (`.claude/hooks/check-spec-format.py`, commit-time): any staged `Documentation/specs/*.md` must carry every pm-format heading (`.claude/agents/pm.md` section 4), and an implementation-phase commit must carry zero `[NEEDS CLARIFICATION]` markers. A `docs:` commit (the draft/clarify phase) may keep markers.
- **Deviations from spec** (`.claude/hooks/check-merge-status.py`, merge-time): a PR that came from a spec must carry a `## Deviations from spec` heading in its body. "Came from a spec" means BOTH the `<type>/spec-<slug>` branch name AND a spec-lifecycle commit headline (`add spec for …` or `remove implemented spec …`) — the commit evidence is what keeps a non-spec branch whose slug merely starts with `spec` (e.g. `chore/spec-lifecycle-gates`) from tripping the gate. A non-spec PR is unaffected.
