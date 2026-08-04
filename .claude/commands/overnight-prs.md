---
description: Autonomous overnight loop — verify issues against the codebase, close stale ones, open review-ready PRs (bug fixes + trio-decided features/improvements, decisions documented), until done or limited
argument-hint: optional — issue numbers to prioritize, or a focus area
---

You are working autonomously overnight on the 2anki/server repo. Your job: verify each open issue
is still relevant against the current codebase, CLOSE the ones that no longer apply, and turn the
relevant ones into review-ready pull requests (one PR per issue) — not just bug fixes, but
features, improvements, and copy/UX changes too. Keep going until you exhaust the queue or hit
your usage limit. The night is wasted if you only close stale issues and ship nothing; aim to
leave a stack of PRs Alexander can review and merge.

Alexander is asleep and will NOT respond — never wait, never ask a question. **The old rule was
"if a decision is needed, SKIP." That is what made past runs unproductive. The new rule: when an
issue needs a product, UX, or copy decision, CONVENE THE TRIO (pm + designer + engineer in one
parallel Agent call), let them make the call, implement it, and write every decision and
assumption into a `## Decisions made overnight` section of the PR so Alexander can review and
override in the morning.** You only SKIP when a change is genuinely unsafe to make unattended
(see the hard rails below) or when you truly cannot tell what the issue is asking even after the
trio looks at it. Defer the *judgment to a documented trio call*, don't defer the *work*.

Optional focus / seed from the invocation: $ARGUMENTS
(If issue numbers or a focus area are given, prioritize those first, then continue with the rest
of the backlog under the same rules. If empty, work the whole open backlog.)

## Absolute safety rules (violating any of these is failure)
- NEVER merge a PR. NEVER run `gh pr merge`. Alexander does all merging.
- NEVER push to `main`. NEVER `git push` without `-u origin <branch>`. Always work on a branch.
- NEVER deploy, NEVER SSH to the prod box, NEVER touch production data.
- One PR per issue, branched off fresh `origin/main`. NEVER stack PRs.
- NEVER put a reporter's name, email, Notion workspace, or deck title in a commit, PR, branch
  name, OR an issue comment. Use the numeric user ID or a symptom description (see
  `.claude/rules/support-confidentiality.md`). Issue comments are public.
- You MAY close an issue and comment on it ONLY under the "Verify relevance" rules below, with
  concrete evidence. You may NOT relabel, reassign, or edit issue titles/bodies.
- Read `CLAUDE.md` and the relevant layer/feature `CLAUDE.md` + `.claude/rules/*` before editing.
  They override your defaults.

## Step 0a — enumerate the FULL open backlog (run ONCE, before any issue work)
`gh issue list` defaults to 30 results and silently truncates; an ad-hoc `--limit 100` still
drops most of a 200+ issue backlog and makes the "no eligible issues remain" stop condition lie.
NEVER rely on the default. Build the complete work queue up front so you know the denominator (M)
from the start:

```bash
gh issue list --repo 2anki/server --state open --limit 1000 \
  --json number,title,createdAt,labels \
  --jq 'sort_by(.createdAt)' > /tmp/overnight-backlog.json
M=$(jq 'length' /tmp/overnight-backlog.json)   # the denominator for the coverage line
```

- `--limit 1000` overrides the 30 default and covers the current backlog with headroom. If the
  count ever approaches 1000, raise it or switch to `--paginate`. NEVER leave it at the default.
- `gh` returns newest-first; `--jq 'sort_by(.createdAt)'` re-sorts OLDEST-FIRST. Work the queue in
  that order — the longest-standing issues are the likeliest to be already-fixed-and-closeable,
  which is the safest, highest-value work to do unattended. Explicit `$ARGUMENTS` issue numbers
  jump the queue first; then resume oldest-first.
- The JSON file — not a live `gh issue list` page — is the source of truth for "what remains."
  Do NOT stop early because a screenful looks done.
- **High-water mark / resumability across nights.** As you finish each issue (PR'd, CLOSED, or
  REACHED-but-left-open), append its number to `/tmp/overnight-processed.txt`, one per line. A
  later night re-runs Step 0a, then works only `backlog − processed` (set subtraction). Do NOT
  re-examine issues a prior run already PR'd or CLOSED. You MAY re-examine an earlier SKIP if the
  code has since changed. This file holds numbers only — never reporter data.
- The goal is real, shipped work: close what's dead and open PRs across all three tiers (bug
  fixes, trio-decided features/improvements, draft migrations). A night that only closes stale
  issues and ships no PRs has not earned its run — work the queue, don't just survey it.

## Step 0 for EVERY issue — verify it's still relevant against the codebase
Before doing ANY work — bug fix OR feature — confirm the issue still describes a real gap in the
current code. Read the actual code paths it names; do not trust the issue text alone.
- For a **bug**: reproduce it against current `main`. Does the broken behavior still happen?
- For a **feature/improvement**: check whether the requested capability already exists or was
  shipped since the issue was filed. Find the code that would implement it; if it's already there
  and working, the issue is done.
- For **either**: confirm the surface, format, or integration it talks about still exists.
- An issue is NO LONGER RELEVANT if you have CONCRETE evidence that:
  - (a) the bug is already fixed — you wrote a test for the reported behavior and it PASSES, or
    the behavior demonstrably works now; or
  - (b) the requested feature/capability is already shipped — point at the code that provides it; or
  - (c) it targets a feature/surface/integration that no longer exists (removed or replaced by a
    shipped redesign); or
  - (d) it is a clear duplicate of another open issue (name the other issue #); or
  - (e) it is junk (a "test" issue, empty, or spam).
- If NOT relevant → CLOSE it with a brief comment, then move on (do NOT open a PR for it):

  ```
  gh issue comment <n> --repo 2anki/server --body "<comment>"
  gh issue close <n> --repo 2anki/server
  ```

  The comment must follow `VOICE.md`: direct, specific, no fake warmth, no exclamation marks. Use
  first person ("I'm closing it") consistently — a real person reads these. Never expose dev terms
  like "main" to the reporter; say "the current version." State what you verified and why it's
  closing, and give a concrete next step. Templates:
  - already fixed: "Checked this against the current version — <specific behavior> works now, so
    I'm closing it. If you still hit this, reopen with the Notion page (or file) that breaks and
    I'll look again."
  - already shipped (feature request): "This is supported now — <specific capability> works in the
    current version, so I'm closing it. If it's not behaving the way you expected, reopen with the
    details and I'll take another look."
  - superseded: "The <surface> this is about has been replaced by <current surface>, so I'm
    closing this. If the problem still happens in the current <surface>, open a new issue and I'll
    pick it up."
  - duplicate: "Same issue as #<m> — tracking it there, so I'm closing this one. Follow #<m> for
    updates."
  - junk / empty / test: "No detail to act on here, so I'm closing it. If this was meant to report
    something, open a new issue with the Notion page (or file) and what went wrong." For genuine
    spam, close WITHOUT a comment — there's no one to address.

  NEVER name the reporter in the comment. NEVER close on a hunch — if you're not sure it's
  irrelevant, leave it open and route it through the eligibility tiers below.
- If it IS still relevant → route it through "What you may open a PR for" below.

## What you may open a PR for — three tiers, not one
The old command only allowed tiny "safe bug fixes" and SKIPped everything else; that is why nights
produced nothing. You may now open a PR for any of the three tiers. Pick the lowest tier that
fits, and always pick the smallest change that resolves the issue, traceable line-by-line.

**Tier 1 — safe bug fix → open READY.**
- A bug (wrong/empty/broken deck, crash, parser/conversion/formatting defect).
- You can write a FAILING TEST that reproduces it, watch it fail for the right reason, then make
  it pass.
- Self-contained (a handful of files); no product/UX/copy judgment needed.
- No hard-rail change (see below).

**Tier 2 — improvement or feature that needs a product/UX/copy decision → run the TRIO, then open
READY with a `## Decisions made overnight` section.**
- A feature request, an enhancement, a copy change, an empty/error/loading state, a small UX fix.
- BEFORE coding, run the trio (pm + designer + engineer in one parallel Agent call) on the issue.
  Take their recommendation as the spec: what to build, what NOT to build, the exact copy.
- Implement it with the same rigor as Tier 1 (tests, /check, sonar, changelog if user-visible).
- Document EVERY decision and assumption in the PR (format below) so Alexander can override.
- Still no hard-rail change.

**Tier 3 — relevant but rests on a risky rail or a big assumption → open DRAFT, flagged.**
- Needs a database migration (write it, run `pnpm kanel`, request `migration-reviewer` in the PR
  body) OR the fix is large/uncertain enough that you want Alexander to gate it before it's real.
- Same trio + documentation as Tier 2, but `gh pr create --draft` and say plainly at the top of
  the body why it's a draft and what you need confirmed.

**Hard rails — these still SKIP, every time (leave the issue OPEN, log why). Never attempt these
unattended:**
- Auth / login / JWT / session / password changes.
- Payments / Stripe / subscription / pricing / quota changes.
- A new third-party integration or a new outbound credential.
- A destructive or irreversible migration (drop/rename column, data backfill that can't roll back).
- Anything you cannot make safe in two attempts, or that you still can't understand after the trio
  has looked at it.

### `## Decisions made overnight` — required in every Tier 2 and Tier 3 PR
List each judgment call the trio made, so the morning review is a yes/no, not an investigation:
```
## Decisions made overnight (please review)
- <decision>: chose X over Y — <one-line trio reasoning>. Assumption: <what I assumed>. If that's
  wrong, change <the specific thing>.
- Copy: "<exact string shipped>" (designer's call). Swap if you'd word it differently.
- Scope: built <A and B>; deliberately did NOT build <C> because <reason>.
```

## Per-issue PR workflow (after Step 0 says "relevant", at the tier you picked)
1. `git checkout main && git pull --ff-only` so you start from a clean, current main.
2. Branch: `git checkout -b <fix|feat>/<short-slug>` (`fix/` for Tier 1, `feat/` for a new
   capability, `fix/` for an improvement to existing behavior).
3. **Tier 2/3 only — run the trio FIRST.** pm + designer + engineer in one parallel Agent call on
   the issue; capture their decisions verbatim for the PR's `## Decisions made overnight` section.
   Tier 1 pure-backend bug fixes skip the trio.
4. TDD: write a colocated `*.test.ts` for the behavior (the failing repro for a bug; the
   acceptance test for a feature). Confirm it fails for the right reason. (Outside-in; mock only
   external edges per `.claude/rules/testing.md`.)
5. Implement the smallest change that makes the test pass. Strip any debug scaffolding.
6. If user-visible, add ONE changelog JSON under `web/src/pages/WhatsNewPage/changelog/` per
   `CLAUDE.md` (user voice, no implementation detail). Internal-only → no entry.
7. `/check` (server tsc + web typecheck + web vitest + web lint) — must be green.
8. `sonar-scanner -Dsonar.host.url=https://sonarcloud.io` (`.claude/rules/sonar.md`); clear new
   smells. If scanner/token unavailable, say so in the PR body.
9. `git rebase origin/main`. Commit with a conventional `fix:`/`feat:` subject ≤72 chars, body
   with `Fixes #<n>`. Co-author trailer per `CLAUDE.md`.
10. `git push -u origin <branch>` (use `--no-verify` ONLY if the pre-push hook false-positives on
    an otherwise-clean new branch).
11. Open the PR: `gh pr create` — READY for Tier 1 and Tier 2, `--draft` for Tier 3 (state why at
    the top of the body). Tier 2/3 bodies MUST carry the `## Decisions made overnight` section.
    If the diff touches `web/src/`, add the `## Browser check` attestation per
    `.claude/docs/browser-attestation.md` (out-clause when there's no runtime-visible effect —
    don't claim a check you didn't run). Link the issue. Do NOT merge.

## Between issues — cleanup
- `git checkout main && git pull --ff-only`.
- Delete abandoned local branches and stale worktrees (`/cleanup` skill, or `git worktree prune`;
  `git branch -D` only on branches with no unpushed work). Keep the tree clean before the next
  issue. Never `git add -A` from a dirty tree — stage by explicit path.

## When blocked or unsure
- Needs a product/UX/copy decision → do NOT skip. Run the trio, take their call, ship it (Tier 2),
  and document the decision in the PR. That is the whole point of this revision.
- Ambiguous scope / more than one reading → let the trio pick the most likely interpretation,
  build that, and write the assumption into `## Decisions made overnight` so Alexander can
  redirect. Only SKIP if it's still unintelligible after the trio looks at it.
- Can't reproduce a reported bug → read the code path it names. If you find a plausible defect,
  fix it with a characterization test and say in the PR "could not reproduce from the report; the
  likely cause is X — please confirm." If there's nothing actionable in the code, SKIP and log.
- Needs a hard rail (auth / payments / new integration / destructive migration) → SKIP, log, leave
  OPEN. These never go autonomously.
- A non-destructive migration → it's Tier 3: write it, run `pnpm kanel`, open DRAFT, request
  `migration-reviewer`. Don't SKIP it just because it has a migration.
- Unsure whether an issue is irrelevant → leave it OPEN; don't close on a guess.
- A failing check you can't resolve in two attempts → leave the PR DRAFT, note the blocker, move
  on. Don't thrash.

## Logging
Running log, one line per issue, with a running counter so the log reconciles against M:
`[idx/M] #NNN <title> → <state>`. There are FOUR terminal states — every issue you reach lands in
exactly one, so the log accounts for every issue you opened, not just the ones you acted on:
- `PR <url> (T1|T2|T3, ready|draft)` — opened a PR; note the tier and whether it's ready or draft.
- `CLOSED: <reason>` — closed per Step 0 (already fixed / already shipped / superseded / duplicate
  of #m / junk).
- `SKIPPED: <reason>` — relevant but hit a hard rail (auth/payments/integration/destructive
  migration) or still unintelligible after the trio looked. Left OPEN. This should be the
  exception, not the default — if you're skipping most issues, you're back to the old broken
  behavior.
- `REACHED: left open` — examined, genuinely nothing to ship and not closeable. Should be rare.

On stop, print the summary in this order — counts are the hero; the four buckets must sum to
"reached", and "reached + never reached" must equal M:

1. **Coverage line first** (a half-awake reader sees this before anything else). "Never reached"
   is load-bearing — do NOT soften it to "remaining" or "pending":
   ```
   <M> open issues. Reached <N>[ before stopping (<limit>)]. Acted on <A> — <c> closed, <p> PRs
   opened, <s> skipped. <R> reached and left open. <M-N> never reached.
   ```
   If N == M, write "Reached all <M>." and "0 never reached." The phrase "no eligible issues
   remain" is true ONLY when N == M.
2. **Why it stopped** — one line: `Stopped: <queue exhausted | usage/token limit | all remaining
   need your input>.[ <M-N> issues never reached — rerun to continue.]`
3. **PRs open for review** — issue #, title, PR URL.
4. **Issues closed** — issue #, title, reason in plain user terms (not tracker shorthand).
5. **Issues skipped — left open for you** — issue #, title, the specific blocker.
6. A trailing count for the `REACHED: left open` bucket (`<R> reached, left open — no action`).

## Stop conditions
Stop when every issue in the Step 0a backlog file has been processed (its number is in
`/tmp/overnight-processed.txt`), OR you hit your usage/token limit, OR remaining candidates all
need Alexander's input. "No eligible issues remain" is true ONLY when N == M from Step 0a — never
infer it from an un-paginated `gh issue list`. ALWAYS emit the coverage line on stop, even when
truncated. Do NOT invent work. Quality and safety over volume.

Begin now. Work continuously. Do not wait.
