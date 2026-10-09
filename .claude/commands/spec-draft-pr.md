---
description: Turn a feature idea or GitHub issue into a one-page spec saved to Documentation/specs/ and opened as a draft PR
argument-hint: <feature description or GitHub issue URL/number>
---

You are orchestrating a parallel trio spec-writing session. The input is: $ARGUMENTS

## Step 1 — Gather context

If `$ARGUMENTS` looks like a GitHub issue URL or number, fetch it with `gh issue view <number>` before anything else.

Read enough of the codebase to orient each agent: skim `CLAUDE.md`, then grep for the key nouns in `$ARGUMENTS` across `src/` and `web/src/`.

## Step 2 — Spawn all three agents in parallel

Launch the following three agents **simultaneously** using the Agent tool (one message, three tool calls):

**pm** — write a one-page spec following the format in `.claude/agents/pm.md` section 4. Include:
- Outcome + goal alignment
- Problem statement with a specific user instance if one can be inferred
- Riskiest assumption + smallest test to disprove it
- Scope (in / out)
- User story + acceptance criteria
- Which leading indicator this moves and by how much
- Open questions for the engineer

**designer** — given the same input, walk the user flow step-by-step and produce:
- The user moment this change addresses
- One concrete design recommendation (layout, primary action, copy strings, empty/error states)
- Any copy strings the user will see, following the rules in `.claude/agents/designer.md`
- Verdict: changes needed to the pm's scope, or "no UI changes required"

**engineer** — given the same input, produce a technical pre-flight:
- **Verify, do not trust, any code-map claim in the issue/source** ("the fix lives in X", "Y is not in the live path", "both paths share Z"). Grep/read the named symbols before repeating them in the spec — a wrong claim propagated into the spec becomes a wrong v1 floor. (Issue #3180 claimed the live Notion-sync path used `DeckParser`/`TagRegistry` interchangeably and that `TagRegistry` was "not in the live tag path"; both false — the sync path is a separate engine that can't host the feature at all. Only caught at implement, after a full spec round.)
- **Platform-capability check — if the feature layers on a third-party service (Stripe / SendGrid / Notion / AWS / Anthropic), confirm the platform does not already provide it BEFORE writing scope.** Any premise of the form "the platform doesn't do X" (Stripe doesn't email on failed payment, SendGrid doesn't handle bounces, Notion doesn't dedupe, …) must be verified against the platform's dashboard settings + docs and the evidence recorded in the spec — never assumed. Building a capability the platform already ships is duplicate work that double-acts in prod. (2026-07-14: PR #3615 specced a custom failed-payment dunning email on the assumption "Stripe's retry emails are off"; Stripe Revenue Recovery already sent it — the build was redundant and closed. Verify the toggle, don't assume it.)
- Which layers are touched (`routes` / `controllers` / `usecases` / `services` / `data_layer` / `web`)
- Files likely in play (list them)
- **If the feature has two delivery paths (file upload via `DeckParser` vs live Notion sync via `BlockHandler`), confirm each path can actually host the feature** — they are independent engines with different tag/card-extraction code; a feature meaningful on one may be a structural no-op on the other.
- Any cross-language coordination needed (TypeScript ↔ Python)
- Estimated effort: S / M / L and why
- Any security, testing, or migration concerns to address before work starts

## Step 3 — Synthesize

After all three agents return, produce a **Synthesis block** before writing the file:

```
### Trio synthesis
- PM: <one line summary>
- Designer: <one line summary>
- Engineer: <one line summary>
- Agreement: <what all three aligned on>
- Conflict: <any disagreement and how it was resolved>
- Resulting plan: <one sentence>
```

## Step 4 — Write the spec file

Derive a short slug from the feature name (e.g. `offline-mode`, `csv-export`). Write the final spec to:

```
Documentation/specs/<slug>.md
```

The file must use the pm format from `.claude/agents/pm.md` section 4, augmented with:
- A **Design notes** section from the designer output (omit if designer said "no UI changes required")
- A **Technical pre-flight** section from the engineer output
- The trio synthesis block at the top, right after the title

Keep it to one page. If the work is bigger, split into numbered files (`<slug>-1.md`, `<slug>-2.md`) and link them.

Leave any unresolved ambiguity marked in place with `[NEEDS CLARIFICATION: <question>]` (see `.claude/agents/pm.md` section 4) — do not guess a value to make the spec read cleanly. The draft is allowed to carry markers; `/implement` resolves them before code lands. `check-spec-format.py` validates the required headings on the spec commit and tolerates markers on this `docs:` commit.

## Step 5 — Open a draft PR

1. Pick the conventional commit prefix the implementation will land under — `feat` for new behavior, `fix` for a bug, `refactor`/`chore`/`perf` otherwise. The branch keeps this prefix through implementation, so don't use `docs/`.

   Create the branch as `<type>/spec-<slug>`:
   ```
   git checkout -b feat/spec-<slug>     # or fix/spec-<slug>, refactor/spec-<slug>, ...
   ```
2. Stage and commit the new spec file:
   ```
   git add Documentation/specs/<slug>.md
   git commit -m "docs: add spec for <feature name>"
   ```
3. Push and open a **draft** PR:
   ```
   git push -u origin <type>/spec-<slug>
   gh pr create --draft --title "spec: <feature name>" --body "..."
   ```
   PR body must include: what the spec covers, a link to the spec file, and the trio synthesis block.

   This PR is the same PR `/implement` will graduate to "ready for review" later — do not close it after spec review, and do not start a second branch when implementation begins.

Return the PR URL at the end.
