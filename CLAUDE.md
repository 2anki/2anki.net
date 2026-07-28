# CLAUDE.md

Express/TypeScript server that converts Notion pages and uploaded files (HTML, markdown, xlsx, zip) into Anki `.apkg` decks. Frontend is the sibling workspace under `web/`.

## Repos — route work to the right one

This checkout (`2anki/server`) is the backend + web app. The **native iOS app is a separate repo**: `Laer-Smart/2anki.app` (Swift/Xcode project at `/Users/a/src/github.com/Laer-Smart/2anki`, with its own `.claude/agents/` trio and an `AppStore/` metadata dir). Match the checkout to the surface:

- **Native app / ASO / App Store listing / store metadata / StoreKit / Swift** → `2anki.app` repo and **its** agents (they have the app, the current listing, the screenshots, the feature set in front of them). Do NOT draft ASO or store copy from this server checkout — it's context-poor and the metadata PR lands over there.
- **Backend, web app, conversion pipeline, Notion/Stripe/Claude integrations, funnel instrumentation** → here in `2anki/server`.

A strategy issue may be *filed* in `2anki/server` for tracking (e.g. #3582 ASO, #3688 native) while the *work* executes in `2anki.app` — create/mirror the actionable issue in `2anki.app` and cross-link (`2anki/server#NNNN`). Open app issues with `gh issue create --repo Laer-Smart/2anki.app`.

## Goal

Mission: give people the simplest, fastest way to turn what they're studying into beautiful Anki flashcards. Drop something in, get a clean deck back.
Scale: grow 2anki.net past 300K users.
Revenue: retention and per-user value are the levers; user count follows. The system sat at its mathematical ceiling (adds ÷ churn) until the June 2026 reprice; never again let user-count work crowd out revenue work. No MRR target is tracked (decision 2026-07-19).
Allocation: every week ships at least one acquisition-facing change — landing pages, SEO, onboarding, or signup/first-conversion friction — and it ships **before** any new product surface starts that week. Acquisition is the only lane that creates users; starve it and the 300K goal stalls no matter how much else moves. History note: 2026 ran 6% acquisition work and 2023-25 ran 0% across 36 months — both starved the only lane that makes users.
Every PR is checked against all three — does it make the experience simpler/faster/more beautiful, does it move us toward scale, and does it (for user-facing changes) state which funnel or revenue metric it should move?

## Memory & sensitive data

- **Do not use the file-based memory system in this project.** The harness memory under `~/.claude/projects/.../memory/` is retired here. Persist durable facts in `CLAUDE.md`, `.claude/rules/*`, or the relevant `FEATURE.md` — anything worth remembering lives in the repo, versioned and reviewable, not in per-machine local memory. Do not write new memory files; if you find yourself wanting to, add a repo doc instead.
- **Never store sensitive or live data.** Business metrics (MRR, ARPU, churn, sub counts), pricing, Stripe/prod settings, individual subscriber or reporter identifiers — retrieve these from production when needed (prod psql, Stripe dashboard/MCP, `/api/ops/*`, `/deploy-status`), never commit them to the repo or a local file. They go stale and they leak.

## Design Context
- **Register**: product
- **Surface(s)**: `/ankify` (sync control panel) — first adopter of the locked DNA; widen as other surfaces follow
- **Purpose**: let paid power users see at a glance that their Notion→Anki sync is healthy and manage where decks land
- **Audience**: lifetime / Auto-Sync subscribers — serious med/law learners running a live 5-min sync
- **Personality**: precise, trustworthy, technical
- **DNA**: Swiss Panel — Swiss/International layout + a monospaced tabular data voice; signature move = the right-hand mono data column. See DESIGN.md.
- **Color**: reuse `web/src/styles/base.css` tokens (5 themes), one blue accent + the status triad — no new ramp
- **Constraints**: React, WCAG AA, the 5-theme token system, product restraint (one signature move exempt)

### Business baseline (as of 2026-07-26 — weekly-retro updates this block)

723 paying subs · 7 new paid/wk · 32 pass sales/wk · 10.1%/mo churn (DB approximation: 73 cancels/30d ÷ 723 active; 87% lifecycle per last-14d cancel reasons, not price) · 15,397 registered (down 376 from 2026-07-19 — inactive-user deletion outpacing 223 gross signups/wk, not churn). MRR/ARPU no longer tracked here (decision 2026-07-19) — dollar figures read off the Stripe dashboard when needed. Funnel events at `/api/ops/metrics`.
Pricing v2 shipped 2026-06-10: $7.99/mo + $64/yr for new members, legacy $6/$60 lock-in until 21 Jun, annual default. Scheduled reads: v2 funnel week of 15 Jun (targets: ≥70 new paid/wk, page→checkout ≥10%, checkout→paid ≥50%); minimal-layout CTR guardrail 24 Jun.

## Entry points

- `src/server.ts` — boots Express, wires routers, runs migrations on startup, marks interrupted Claude jobs.
- `src/routes/` → `src/controllers/` → `src/usecases/` → `src/services/` → `src/data_layer/` (DB).
  Each layer has its own CLAUDE.md — read it before editing.
- Hot path docs — read the matching one before touching that surface: `src/lib/parser/FEATURE.md`, `src/services/NotionService/FEATURE.md`, `src/services/observability/FEATURE.md`, `src/lib/ankify/FEATURE.md`
- Copy and voice guide: `VOICE.md` — read before writing or changing any user-facing string
- MCP server setup: `.claude/MCP_README.md`
- Deeper context: `Documentation/`, `ROADMAP.md`.

## Run it

- Install: `pnpm install` (never `npm`/`yarn`).
- **Fresh worktree? Run `scripts/worktree-setup.sh` (or `pnpm install && pnpm --filter 2anki-web install`) as the FIRST action — before any test/lint/format/commit.** A `git worktree add` / `EnterWorktree` checkout has NO `node_modules` and NO Oxc native binaries; `pnpm test`/`oxfmt`/`oxlint` all fail with `jest: command not found` or `Cannot find native binding` until you install. See the worktree-readiness gotcha below; don't burn a dozen calls rediscovering this mid-task.
- **Ask before starting the server.** Dev: `pnpm dev` (server + web). Server only: `pnpm dev:server`.
- TypeScript scripts: `npx tsx <script>` — never `ts-node`.
- Tests: `pnpm test <path>` to scope to one file. **To filter by test name, the flag MUST go after `--`: `pnpm test -- <path> -t "name"`.** A bare `pnpm test <path> -t "name"` silently swallows `-t` and runs the WHOLE file (you'll see unrelated failures and misread them as yours). If output is truncated, rerun without coverage.
- All-green gate: `/check` (parallel server tsc + web typecheck + web vitest + web lint).
- Migrations: create with `npx knex migrate:make <name> --knexfile ./src/KnexConfig.ts --migrations-directory ../migrations -x js`.
- **kanel runs IN the migration PR, never after — this is a hard gate.** A migration PR is not ready until `pnpm kanel` has regenerated `src/data_layer/public/` against the applied migration and those regenerated files are committed **in the same PR**. Hand-writing a generated type and deferring `pnpm kanel` to "later" is not an acceptable shipping state — the hand-written type drifts from the real schema and the deferral lands on Alexander. If a change adds/alters a table or column, the PR diff MUST include the matching `src/data_layer/public/*` regeneration.
  - **Recipe (works around the two things that make people defer):** (1) apply the new migration to your local Postgres first — kanel reads the *live* schema, not the migration file (boot the server once, or run the migration via a `tsx` knexfile on `DATABASE_URL`). (2) `pnpm kanel` reads discrete `POSTGRES_*` from `.env` via `.kanelrc.js`, and **`.env`'s `POSTGRES_USER=postgres` is stale** — a `role "postgres" does not exist` error means override inline: `POSTGRES_USER=<role from DATABASE_URL> POSTGRES_DATABASE=<db from DATABASE_URL> pnpm kanel`. `.kanelrc.js` has `preDeleteModelFolder: true`, so kanel regenerates the *whole* `public/` folder — `git add` only the files your migration actually changed; leave unrelated formatter-noise regenerations reverted.
  - **In a worktree that can't run kanel** (no local Postgres, no `POSTGRES_*`): do NOT hand-write and defer. Run `pnpm kanel` from the **main checkout** (which has node_modules + the local DB) against the applied migration, then copy the regenerated `public/*` into the worktree branch before flipping the PR ready. Never edit `src/data_layer/public/` by hand.
- Production deploys via the `deploy.2anki.net.yml` workflow; verify with `/deploy-status` after.

## Rules (loaded from .claude/rules/)

Always loaded — hot on most sessions:

@.claude/rules/security.md
@.claude/rules/testing.md
@.claude/rules/code-quality.md
@.claude/rules/dependencies.md
@.claude/rules/sonar.md
@.claude/rules/support-confidentiality.md
@.claude/rules/browser-attestation.md
@.claude/rules/first-time-fix.md

Load on demand — read these when the task touches the named surface (kept out of standing context to save tokens):

- `.claude/rules/email-templates.md` — read before editing any template under `src/services/EmailService/templates/`.
- `.claude/rules/parallel-pr-coordination.md` — read before kicking off a multi-PR batch (more than two PRs in flight) or running `/spec-draft-pr` more than once in a row.
- `.claude/rules/local-dev.md` — read when running toolchain/migrations/checks locally on the maintainer's machine, working out of a git worktree, or diagnosing a pre-push/deploy-status oddity.
- `.claude/rules/i18n.md` — read before adding or changing any user-facing string, adding a language, or fanning out translation work. The web app ships in 10 locales via a glob namespace loader; a string added in one locale but not the other 9 renders stale/wrong.

## Git

- Conventional commit prefixes: `feat:`, `fix:`, `chore:`, `refactor:`, `test:`, `docs:`, `perf:`, `ci:`, `build:`, `style:`, `revert:`. Keep the **subject ≤ 72 characters** — a commit-message hook rejects longer subjects; push the detail into the body, which must carry a real **why** (≥40 chars of non-trailer text).
- **Commit-message mechanics — avoid the hook fighting you.** Use `git commit -m "<type>: subject" -m "<why body>"` (the hook reads *every* `-m`: subject = first, body = the rest), or `git commit -F <file>` where the file was written in a **separate** Bash call. **Never put a `cat <<EOF` heredoc in the same Bash call as `git commit`** — a *failed* commit-msg check reverts the working tree and deletes the untracked file you just wrote (e.g. a changelog). Two calls: (1) write files, (2) `git add <paths> && git commit …`. See `.claude/hooks/check-commit-message.py`.
- Suggest a branch name before starting code changes; format `<type>/<short-slug>`.
- Always rebase on `origin/main` before opening a PR.
- One PR per feature. Never stack PRs — the deploy pipeline pulls a single branch.
- Push pattern: `git push -u origin <branch>` — never bare `git push`, never to `main`. The `safety.py` hook blocks both.
- **Open PRs with `gh pr create --repo 2anki/server --base main --head <branch>`.** Bare `gh pr create` resolves the base to the upstream fork parent and fails with `No commits between Laer-Smart:main and 2anki:<branch>`; the explicit `--repo`/`--base`/`--head` form is the reliable one. (The PR URL prints as `Laer-Smart/2anki.net` — that's the canonical remote; same repo.) Same `--repo 2anki/server` for `gh pr view`/`merge`/`list`.
- When a unit of work is done, ship it: commit, push, and open the PR **ready for review** with `gh pr create` — not `--draft`. A finished unit of work handed to Alexander is something he's meant to look at, so it goes up ready. Reserve `--draft` for work that genuinely isn't reviewable yet: a `/spec-draft-pr` spec awaiting `/implement`, or a WIP you've explicitly flagged as WIP.
- **Before flipping a PR ready (or before pushing a non-trivial code change), run `sonar-scanner` locally.** `/check` does not run SonarCloud's rule engine; cognitive complexity, nesting depth, redundant type assertions, and a11y smells only surface after the push. See `.claude/rules/sonar.md` for setup and the exact command. Skip only for pure doc/dep/test/typo changes.
- Before `gh pr merge`: every `statusCheckRollup` entry must be non-FAILURE (not just required ones). The `check-merge-status.py` hook enforces this.
- **`gh pr ready` gets the same green gate as merge**: flip only when every `statusCheckRollup` entry is COMPLETED and non-FAILURE. A ready PR is a merge invitation — flipping with a check still IN_PROGRESS handed Alexander a "merge if ready" on a PR whose test shard then failed (#3908). Wait the ten minutes.
- Implementing a GitHub issue? Put `Closes #NNNN` in the PR body so the merge auto-closes it — #3908 needed a manual `gh issue close` because the link was missing.
- Run the browser-attestation `gh pr edit --body` (ticking the boxes) and the `gh pr merge` as **two separate Bash calls** — the merge hooks scan the whole command string for `gh pr merge`, so chaining `edit && merge` trips the gate before the edit lands.
- First push of a new branch: if the `pre-push` hook blocks with a WIP/false-positive warning on an otherwise-clean branch, re-run with `git push -u origin <branch> --no-verify` (the hook false-positives on a new branch's first push; only bypass when the branch is genuinely clean).
- Touching auth, payments, or external-API integration? Run `/security-review` before merge.
- After merge, clean up local: `git checkout main && git pull --ff-only`, confirm the PR is `MERGED` via `gh pr view <branch> --json state`, then `git branch -D <branch>` (squash-merges leave the tip unreachable from main, so `-d` refuses). `git fetch --prune origin` drops stale remote-tracking refs; `git worktree list` then `git worktree remove <path>` (or `git worktree prune` if the dir is already gone) clears unused worktrees.
- **When Alexander asks to check out a PR, just do it.** Run `gh pr checkout <n>` yourself. If `gh` complains the branch is `already used by worktree at .claude/worktrees/agent-*`, that's an agent worktree from a previous run — the PR is already on the remote, the agent's local copy is redundant. Unlock + remove it (`git worktree unlock <path> && git worktree remove <path>`), then re-run `gh pr checkout <n>`. Do not return a menu of options for Alexander to copy-paste — pick the right answer and execute it.
- GitHub issues for follow-ups that need cross-cutting visibility, labels, or contributor pickup. Commit bodies for inline scope notes that travel with the change.

## Working speed

- **Default to inline. Reach for a subagent only for parallelism, isolation, or context hygiene — never for single-task speed.** For ONE sequential task, inline is *faster*: a subagent pays a tax inline doesn't — fresh-worktree `pnpm install` (both workspaces), cold context re-reading every file from scratch, and a branch reconcile at the end. Same coding work, more setup. Subagents earn their cost only when the work is genuinely parallel (N independent tasks at once — a trio, a multi-PR fan-out), when isolation is required (risky auth/payments/migration edits in a worktree), or when keeping the main context lean matters. If you already know the files and the change is a single edit-and-test loop, do it inline.
- For research spanning 3+ queries (where is X defined, what touches Y), spawn `Agent(subagent_type=Explore)`. If the result isn't immediately needed, run it with `run_in_background: true` and keep editing.
- **Multi-agent adversarial review (ultracode/Workflow) is for high-blast-radius surfaces only** — parser core, payments, auth, migrations — where execution-verified skeptics catch what CI/Sonar can't (#3908: 22 confirmed findings, exactly 1 of which CI caught). Small fixes, copy, deps, ops buttons run lean: inline implement + single review. The review pass runs **before** `gh pr ready`, on the draft.
- For risky changes (auth, payments, migrations, deploy pipeline), **must** use `EnterWorktree` — reverting a worktree is free. See `.claude/agents/engineer.md` for the enforced path list.
- For "wait until X" (long builds, CI, deploys baking on prod), use `ScheduleWakeup` (270s if cache-warm matters, 1200s+ for genuine waits). Never busy-poll with sleep.
- **After a multi-agent session, reap orphans and remove done worktrees — parallel agents cook the laptop.** Each agent running `/check` stacks `node`/`tsc`/`jest` procs that outlive it, and `pnpm dev`/`vite preview`/golden-path servers reparent to init when their session exits (a 2026-07-18 run hit load average 40 with 23 stacked procs + a 3-day and an 11-day dev server). Diagnose a slow box with `uptime` + `ps aux -r | head`, run `scripts/reap-orphans.sh` (dry run) then `--force`, and `git worktree remove` finished agents' worktrees. Full playbook in `.claude/rules/local-dev.md` ("Orphaned process hygiene").
- After deploys to 2anki.net, run `/deploy-status` to confirm the box is healthy.
- If you keep approving the same read-only Bash commands, suggest `/fewer-permission-prompts`.
- **Report tight.** State each outcome in one line; skip the "what I did / what changed / what's next" recap unless asked for status — Alexander reads the diff and PR body, don't re-narrate them. The exception is confirming a risky/destructive step first — that's safety, not chatter.
- **Every PR/issue/run mention gets a full clickable URL** (`https://github.com/2anki/server/pull/NNNN`), never a bare `#NNNN`. Reports are read in a terminal and clicked through.

## Process

- Surface assumptions before coding. If a request has multiple valid interpretations, present them — don't pick silently. If something is unclear, stop and ask. If a simpler approach exists, say so.
- **Execute, don't menu.** "Multiple interpretations" applies to *what* to do; it does not license menus of *how to do it*. When the answer is a sequence of mechanical sub-steps with one obvious right path (resolve a worktree conflict on `gh pr checkout`, drop two named stashes after a wave merges, run `pnpm install` before a dev server) — pick the right path and execute. A response that hands Alexander "option A vs option B" for mechanical glue is a failure mode. Reserve confirmation for destructive/irreversible steps (force-push, branch -D on unmerged work, anything in the `Executing actions with care` list).
- Every changed line should trace directly to the user's request. If a diff includes lines that don't connect back to what was asked, remove them before committing.
- TDD by default: failing test → verify it fails for the right reason → simplest pass → refactor. If asked to skip tests, confirm first. First rewrite a vague task into a verifiable goal — "fix the bug" → "write a test that reproduces it, then make it pass"; "add validation" → "test the invalid inputs, then make them pass". A strong success criterion lets you loop unattended; a weak one ("make it work") forces a round-trip.
- Outside-in testing. Mock only external dependencies (HTTP, third-party APIs, email) — never internal services.
- A passing suite is not proof of correctness — review affected user flows for regressions before committing.
- Before declaring a task done, strip scaffolding, debug logs, and temporary code added during implementation.
- When the user asks to test a PR locally, get the branch checked out in the **main repo** (`gh pr checkout <n>`) and stop — the user starts `pnpm dev` from their own terminal. Don't launch a dev server yourself.
- When triaging a support `.eml`, extract and Read every image attachment before any code investigation — screenshots disambiguate which product surface the user means (e.g. the one-shot converter vs Ankify are different code paths). Treat "see attached" as a blocking read, not decoration.
- When writing an agent brief, keep dictated PR/commit text and agent-behavior rules (don't merge, halt conditions) in **separate** paragraphs — a subagent pastes anything adjacent to "the body should say X" into the public PR body verbatim. After any agent opens a PR, skim the body before handing it over.
- **Before dispatching work on a GitHub issue (yours or an agent's), check whether it's already fixed.** `git log -S` the relevant condition/gate, or check the referenced commit if one exists in the issue/PR history. 2026-07-23: a fully-scoped trio review was launched on issue #3758 before noticing a commit from two days earlier had already implemented and closed it (the auto-close link just hadn't fired) — caught only because the designer agent independently stumbled on the prior commit while reading the page component. Five minutes of `git log` up front is cheaper than a wasted trio dispatch.
- When a spec or brief locks an enumerated set (marker syntax, block-type lists, candidate vocabularies, thresholds), the set is **closed**: an agent extending it must flag the extension as a decision in its report, never ship it silently. The #3908 MCQ wrong-answer bug was an unflagged one-character extension (`.` added to the locked `:` separator set) that turned quiz option labels into answers.
- When writing an agent brief that says "mirror pattern X" (an existing route, use case, or feature), first find every layer X actually has — not just the layer the task names. A backend route mirrored from another backend route can still ship with no way to trigger it if the pattern's UI half goes unchecked (see the `code-quality.md` ops-command row). Grep for the sibling's full call chain, frontend included, before scoping the brief.
- When browser verification isn't readily available in the environment (no Chrome channel, no dev-server access) and the change is a small, well-tested, exact mirror of an existing already-shipped pattern, say so plainly in the PR's browser-check section and move on — don't burn multiple tool calls hunting for an alternate browser binary or a workaround, especially after the user has already signaled urgency. State the honest limitation once; let the human verify if they'd rather do that than wait.

## Gotchas

- **Oxc binding still missing after the worktree install** (see "Run it" for the install itself)? Re-run `pnpm install --force` or `pnpm rebuild` — never hand-fetch the native `.node` or `pnpm add -w @oxfmt/...`. Full incident detail and the why lives in `.claude/rules/parallel-pr-coordination.md` (first table row) — don't duplicate it here.
- **Can't run `oxfmt` locally? Format defensively, don't push and let CI bounce you.** `oxfmt --check` (the `static` CI job's Format step) fails the whole job — and because it scans `src web/src` tree-wide, a single mis-wrapped line costs a full rebase + force-push + CI cycle (~3–5 min). When the formatter won't run in your environment, match the existing file's conventions exactly before pushing: single blank line between top-level blocks (never two), and wrap any string/call argument that pushes a line past the project width onto its own line (oxfmt breaks `expect(x).toHaveAttribute(...)` and `{ message: '<long string>' }` this way). Two real 2026-06-15 bounces — a double blank line before a new `describe` and an over-width `503` JSON message — were both this shape.
- **A merged format failure poisons every subsequent PR — and a per-file `oxfmt` run is NOT the CI check.** CI's `static` job runs `pnpm format:check` = `oxfmt -c .oxfmtrc.json --check src web/src` tree-wide. An agent that runs `oxfmt` on only its changed files (or with a different config) reports "clean" while the tree-wide check fails; if that PR merges red, EVERY later PR's `static` fails, listing the drifted files (the whole-tree scan surfaces them all). Two hard rules: (1) run `pnpm format:check` — the exact CI command — before every push, not a per-file `oxfmt`; (2) **green-gate merges**: never merge while any `statusCheckRollup` entry is FAILURE — verify green explicitly, do NOT assume the merge hook caught it (a non-required `static` FAILURE merged through in a 2026-07-17 i18n batch and drifted 18 files onto `main`). If `main`'s `static` is red, fix the whole tree in one `style:` PR (`pnpm exec oxfmt -c .oxfmtrc.json --threads 1 src web/src`) and merge it before anything else.
- **The auto `claude-review` workflow was removed (2026-07-22).** It ran the `code-review` plugin on every PR, whose findings surface through a host-UI tool (`ReportFindings`) the GitHub Action never wired to a PR comment — so it exited green, spent ~$0.46/PR, and posted **nothing** (verified across 10 PRs: 0 comments, 0 reviews). On-demand review still exists via the `@claude` mention workflow (`.github/workflows/claude.yml`). If a stale `claude-review` check ever reappears, it is not a merge blocker.
- **The local git `pre-push` hook must NOT run `npm run lint:fix`.** `.git/hooks/` is untracked (never cloned), so this is per-machine. A `lint:fix` line there whole-tree-autofixes on every push, dirtying unrelated files (`DeckParser.ts`, `extractApkg.ts`, `UploadService.ts` recurred all session) whose fixes aren't staged and never ship — pure pollution that forces a `git checkout --` dance before each rebase/commit. Lint/format are already enforced non-destructively by CI (`pnpm lint` + `format:check`) and the Claude pre-push hooks (`oxfmt --check` / `oxlint` on changed files). If a fresh clone or teammate re-adds the `lint:fix` line, strip it.
- **Never edit `src/data_layer/public/`** — Kanel-generated; rerun `pnpm kanel` instead.
- The Ankify feature is gated to users with `users.patreon = true` (lifetime), `users.ankify_access = true` (per-user comp grant), **or** an active `subscriptions` row whose `stripe_product_id` matches `AUTO_SYNC_PRODUCT_ID`. Use `hasAnkifyAccess` from `src/lib/ankify/access.ts` (single source of truth); don't reintroduce hard-coded emails.
- **Two distinct paid gates — `isPaying` vs `hasAnkifyAccess` — don't conflate them.** `isPaying` (`src/lib/isPaying.ts`, read off `res.locals`) = ANY active paid subscription; it exempts the monthly card limit (100) and PDF print limit (1). `hasAnkifyAccess` (`src/lib/ankify/access.ts`) is the stricter Ankify/Auto-Sync gate (lifetime `patreon` OR `ankify_access` comp OR active Auto-Sync-product subscription). **Mindmaps are TIERED across both:** free `3` maps / `50` nodes → subscriber (`isPaying`) `25` / `250` → `hasAnkifyAccess` unlimited (`SUBSCRIBER_MAP_LIMIT`/`SUBSCRIBER_NODE_LIMIT` in the mindmap use cases; the `MindmapLimitError` carries the caller's actual applicable cap, and the client renders it via a `{{limit}}` i18n placeholder). When adding a paid perk, decide which gate it belongs to — a normal `$7.99/mo` subscriber has `isPaying` true but `hasAnkifyAccess` false.
- **Chat has two non-obvious invariants (2026-07-17).** (1) An uploaded attachment's extracted text is persisted in `chat_messages.attachment_text` and replayed into model history (capped at 20k chars) so follow-up turns keep the document — before this, attachments were per-message only and the model would contradict itself ("I don't see any attachment") one turn later. (2) Each assistant turn downloads in ITS OWN note type, derived from that turn's card shapes (`effectiveTemplateForCards`), NOT the conversation-global selector — so an earlier MCQ turn exports as MCQ even when the pill sits on Basic. The template pill reflects the last turn's actual cards; if the AI overrode the requested type, re-selecting it forces a regenerate instead of a no-op. Deck-name on download is suggested from the AI's `Deck: <name>` line, else the conversation title.
- **`STRIPE_SYNC_ON_STARTUP` is `false` on prod (verified 2026-07-27; last sweep ran 2026-07-14) — nothing repairs a drifted `subscriptions` row automatically.** This flag used to be on, and several safety assumptions in this repo were written against that. **Do not lean on the sweep as a backstop:** any path that fails to deactivate a row on cancellation now leaks paid access permanently rather than being cleaned up on the next deploy (this is exactly how #3862 stayed invisible — prod logs show the sweep quietly repairing rows that had leaked for hours to days). When the flag *is* enabled, every deploy/restart re-runs the full Stripe sync + `reconcileActiveSubscriptions`, which retrieves each active row's `payload.id` from Stripe and flips the row inactive on a 404 — so a synthetic row survives only if its `payload` has no parseable `id` (e.g. `{}`), and `cancelUnlinkedSubscriptions` cancels/emails any active row whose `email` isn't in `users`. Prefer a real access mechanism (`users.ankify_access`) over a fake `subscriptions` row for comps either way.
- Notion webhook receiver in `routes/AnkifyWebhookRouter.ts` is mounted and fully implemented (HMAC-verified, access-gated, dispatches a `trigger: 'webhook'` sync) but unfed: Notion-side auto-registration is deferred, so no production webhooks reach it and polling at 5 min carries the story today. See `src/lib/ankify/FEATURE.md` for the secret/registration shape.
- **The prod deploy build typechecks tests too.** `deploy.2anki.net.yml`'s build step is `tsc -p .`, which compiles `*.test.ts`. Add a method to an interface and any test mock typed as that interface (a `const repo: IFoo = { … }` literal missing the new method) becomes a **deploy failure**, not just a Jest failure — and the Jest shards in CI can still pass (ts-jest is per-file/isolatedModules), so the red deploy looks unrelated to the change. After any interface change, run `tsc -p . --noEmit` locally and grep `src/**/*.test.ts` for object literals typed as that interface. (2026-05-31: `loadIfExists` added to `ISettingsRepository` left a mock behind → red `main` deploy until the mock was fixed.)
- **Local `tsc` can pass while CI's `static` job fails the same file.** The main checkout's `node_modules` drifts from the lockfile over a long-lived session, so a stale local type resolves clean while CI (fresh `--frozen-lockfile` install) fails on it. If CI `static` reports a type error you can't reproduce locally, reproduce in a clean-install worktree (`pnpm install` from a fresh `git worktree add`) before assuming it's a false positive — a red `static` may be a latent breakage already on `main`, not just your diff.
- **Netlify deploy previews are decorative — do visual review with `pnpm dev` on the branch.** The root `netlify.toml` force-301-redirects every path (`from = "/*"`, `force = true`) to `https://2anki.net`, including `deploy-preview-<n>--notion2anki.netlify.app`, so every PR preview bounces to prod and shows nothing. The Netlify project is a legacy-domain redirect and the same config runs for previews. Don't chase a preview URL for UX review. (Fix, if ever worth it: scope the redirect under `[context.production]` and give previews a real publish dir.)
- The prod box checks out this repo at `/home/alemayhu/src/github.com/2anki/2anki.net` (legacy name).
- **Writing an email means creating a `.txt` file in the user's Downloads** — `/mnt/c/Users/alexa/Downloads/` on this WSL box (the Windows Downloads, where uploaded `.eml` files land) — not just printing the draft in chat. Use `reply-<name>.txt` for support replies. Offline Downloads files may carry reporter names/emails; commits, PRs, and issues may not (see `.claude/rules/support-confidentiality.md`).
- **Rendering Notion-hosted file URLs in card output — never pass through the raw URL.** Notion's `file.url` (PDFs, images, audio, file blocks) is a signed S3 URL that expires roughly an hour after generation. A card that embeds the URL directly (`<embed src={url}>`, `<img src={url}>`, `<a href={url}>` as the only delivery) breaks the moment the signature lapses — users see a broken element on every platform. Always route Notion-hosted assets through `BlockHandler.embedImage` / `embedFile` / `embedAudioFile`, which download the bytes via `instrumentedAxios` and bundle them as Anki media (filename = SHA-512 hex digest, no path traversal, durable inside the `.apkg`). External URLs (the user pasted a real third-party URL into Notion — `type === 'external'`) don't expire and render fine as plain links. Discriminate on `block.<type>.type === 'file'` for the download path; `'external'` stays as a link. Heavy assets (PDFs in v1) can be gated behind an opt-in `CardOption` so users decide between `.apkg` bloat and a working file (see #3068 / `downloadPdfs`).
- **Bot reviews check code patterns, not runtime lifecycle.** The `@claude` review bot is good at finding correctness bugs, type mismatches, missing tests, and Sonar-class smells. It does NOT model external-resource lifecycles — signed URL expiry, OAuth refresh windows, cache TTLs, session token rotation. PR #3068 was a clear example: bot cleared the diff as correct, missed that the embedded Notion S3 URL would 403 within an hour. Always pair a bot review with manual runtime-thinking on anything that consumes an external URL or a time-bound credential.

## The trio

Three core sub-agents in `.claude/agents/`:

- **engineer** (opus) — implements specs, reviews PRs, writes tests, ships.
- **designer** (opus) — UI/UX decisions, copy, visual consistency.
- **pm** (opus) — feedback synthesis, prioritization, spec writing, metrics.

Default: `pm` produces a spec → `designer` validates UX (only if user-facing) → `engineer` implements and ships. For tiny fixes, skip to engineer.

**Supporting cast** (specialists, invoke by name): conversion-funnel-analyst, seo-content, seo-specialist, prod-incident-responder, migration-reviewer, support-triage, a11y-reviewer, test-writer, dead-code-auditor. Each one's description and when-to-use lives in its `.claude/agents/*.md` frontmatter and loads into the session's agent list — don't duplicate them here.

Trio conventions: be opinionated (one recommendation, not five options); specs fit on one page; say what *not* to build; reply to support email *as a draft for Alexander to send*, saved as a `.txt` file in Downloads (see Gotchas).

## Trio review policy

For any task that changes user-facing behavior, invoke `pm`, `designer`, and `engineer` subagents **in parallel** via the Agent tool before writing code. Synthesize their input, surface any conflict explicitly, then proceed.

**Trio required:**
- New features or changes to existing features
- UI/UX changes, copy that users see
- Pricing, limits, quotas, or API surface changes
- Onboarding, signup, payment, or core conversion flows
- Cancellation and churn surfaces — any cancel-flow change must weigh a retention offer (pause, downgrade, legacy-rate reminder); 79% of churn is lifecycle, and this surface owns it
- New product surfaces — the synthesis must state the usage event that ships in the same PR, the day-7 prod check, and the T+30d adoption-review issue (see Surface lifecycle)
- Refactors that change user-visible behavior

**Trio optional (proceed unless you sense a product question):**
- Pure refactors with no behavior change
- Test fixes, CI/build issues
- Dependency bumps, internal-only tooling
- Documentation that isn't user-facing

**Synthesis format** (produce this before acting on any trio task):
- What each agent said (one line each)
- Where they agree
- Where they conflict, and how the conflict was resolved
- The resulting plan
- Expected MRR/funnel impact — which metric should move, where it is read, and when (one line; "none — internal" is a valid answer, silence is not)

**When the trio disagrees on a visual direction, don't pick silently — ship a preview.** Build a `/dev/<surface>-preview` route that renders each candidate side by side with prefilled state for every variant the surface supports (free / paid / lifetime user, loading / error / empty, etc.). Use direct prop injection on the existing components — don't re-mock the data hooks. No auth gate, no nav link, no analytics. Push it as part of the draft PR so the user can open it locally with `pnpm dev` and choose from visuals. The preview route stays in the repo after merge as a regression check; remove only if the surface is deleted. Example: `/dev/account-preview` and `/dev/notion-preview` shipped with `style/account-redesign`.

**Gate preview routes on `import.meta.env.DEV` so the chunks aren't emitted in prod.** Pattern:
```ts
const FooPreviewPage = import.meta.env.DEV
  ? lazy(() => import('./pages/FooPreviewPage/FooPreviewPage'))
  : null;
// later, conditionally registered in the router:
{FooPreviewPage && <Route path="/dev/foo-preview" element={<FooPreviewPage />} />}
```
Vite's tree-shaker drops the dead branch in production builds — the `import()` call becomes unreachable, so the chunk file never lands in `web/build/assets/`. Verify with `pnpm --filter 2anki-web build` and grep the chunk list.

Use `/trio <task>` to force a trio review on any prompt regardless of the heuristic. See `.claude/commands/trio.md`.

## Spec lifecycle

Specs live in `Documentation/specs/` only while a feature is in flight. Workflow:

1. `/spec-draft-pr` writes the spec and opens a **draft** PR on a branch named after the eventual commit type — `feat/spec-<slug>`, `fix/spec-<slug>`, `refactor/spec-<slug>`, etc. Never `docs/spec-<slug>` — that branch can't graduate to `feat:`/`fix:` cleanly.
2. `/implement` takes that same draft PR over: `gh pr checkout`, codes on the same branch, renames the PR title from `spec: …` to `<type>: …`, and runs `gh pr ready`.
3. Before the final push, `git rm Documentation/specs/<slug>.md` in a `chore: remove implemented spec for …` commit. The folder stays small.
   - **After squash-merge the spec text is NOT recoverable from main's history** — `git log -p -- Documentation/specs/<slug>.md` returns nothing (the squash nets the add+remove to zero). Recover it from the spec PR instead: `gh pr view <n> --json commits` for the docs-commit SHA, then `gh api "repos/2anki/server/contents/Documentation/specs/<slug>.md?ref=<sha>" --jq .content | base64 -d`. Don't cite the git-log path in issue bodies — several existing issues repeat that broken claim.

Do not open a separate implementation PR alongside a spec PR. Do not let `Documentation/specs/` collect specs for already-shipped work.

## Surface lifecycle

A new `feat:` surface (a distinct user-facing capability — chat, mindmaps, photo-to-deck, transform, print, quizlet import, image occlusion, ankify) ships with two things in the same PR: a usage analytics event that fires when the surface is used, and a T+30d adoption-review GitHub issue created at merge with the review date in the title. At that review the verdict is binary — **keep or remove**. Silence is removal, not maintenance; an unused surface is a maintenance tax with no offsetting users. History: 8+ surfaces shipped in May 2026 with usage evidence for only 2-3, and one (quizlet import) went silent within days and nobody noticed.

One new surface in flight at a time. The next surface does not start until the previous one has a day-7 prod check and a usage signal. Six years of unmeasured parallel bets (Imba, Electron, KI, avatars, Gemini, Quizlet) is why this gate exists — breadth without evidence is how the backlog filled with surfaces no one uses.

## Changelog

User-visible changes ship with a changelog entry in the **same PR**. The entry lands as a new JSON file in `web/src/pages/WhatsNewPage/changelog/` and renders in the in-app "What's New" page. One entry = one file, so parallel PRs never conflict. Enforced at merge: `.claude/hooks/check-changelog-on-merge.py` blocks `gh pr merge` when a `feat:`/`fix:` commit touches source but adds no changelog JSON and the PR body has no "no changelog entry" out-clause.

**When to add an entry.** Add one if a real user would notice the change. Don't add one if they wouldn't.

| Commit type | Entry? |
| --- | --- |
| `feat:` — new feature or new capability | Yes |
| `fix:` — bug a user could hit | Yes |
| `revert:` — undoing something users could see | Yes, otherwise no |
| `perf:` — only if the user perceives the speedup | Yes, otherwise no |
| `style:` — UI change a user would notice | Yes, otherwise no |
| `refactor:`, `chore:`, `test:`, `ci:`, `build:`, internal `docs:` | No |
| Bumping a dependency that doesn't change behavior | No |

If you can't write the entry without referencing internal files, classes, or refactors, the PR probably doesn't warrant one. State that explicitly in the PR body ("no changelog entry — internal refactor, no user-visible behavior change") rather than going silent.

**How to write the entry.** Follow `VOICE.md`. The reader is a busy learner skimming the What's New page — they want to know what they can do now that they couldn't before, or which bug stopped affecting them. The conventions below match the existing entries in `web/src/pages/WhatsNewPage/changelog/`; new entries must match the existing files, not drift from them.

**File shape.** Create `web/src/pages/WhatsNewPage/changelog/YYYY-MM-DD-short-slug.json` with `{ "id": "YYYY-MM-DD-short-slug", "date": "YYYY-MM-DD", "type": "feature" | "fix" | "style", "title": "Sentence-case one-liner" }`. The `id` must equal the filename without `.json` — the loader asserts uniqueness at startup. Sort order is `id` descending, so the date prefix drives ordering and the slug breaks ties.

- User voice, not engineering voice. What changed *for the user*, not what we changed in the code.
- Specific over generic. Name the surface, the file format, the count — whatever makes the entry useful. If you have a number, use the number; don't write "about twice as fast" when you don't.
- No implementation details. No file names, class names, library names, commit shas, ticket numbers, "we refactored X", "we migrated Y". The user does not care and shouldn't have to.
- **Sentence case. No trailing period.** Matches every line in the current file. A trailing period on a one-line entry reads like an essay.
- One line, ~120 characters max. No multi-sentence entries.
- Start with the surface or the noun (the deck, the upload, password reset, sign in with Notion), not "Added"/"Fixed"/"Now". The type tag already says `feature`/`fix`; repeating it in prose is noise.
- No hedge filler that implies prior brokenness: avoid "actually", "finally", "now properly", "no longer broken". These tell the user the thing was bad before — which most of them never noticed.
- The em-dash is for adding specifics ("Theme switcher — light, dark, gold, and purple"), not for explaining a fix ("— no more waiting"). Don't apologize on the same line.

Good vs bad:

| Bad (don't ship this) | Good (ship this) |
| --- | --- |
| Refactored Notion image extractor | Notion pages with embedded images convert even when one image fails to load |
| Fixed bug in EmailService | Password reset emails arrive within seconds |
| Migrated S3 client to v3 SDK | (no entry — internal-only) |
| Improved performance | Large Notion exports convert in about half the time |
| Added `useDeckSettings` hook | (no entry — internal-only) |
| Added auto-login on registration | Signed in automatically after creating your account |

**The `/changelog` slash command** is the batch tool for backfilling a window of merged PRs into blog/SEO content. It is not a substitute for the per-PR entry — by the time `/changelog` runs, the entry should already be in the file.

## Support email

Support replies go to `~/Downloads/reply-<name>.txt` for review before sending. Follow VOICE.md guidelines — direct, specific, no hedging. Additional rule: **never use dashes (em-dash or hyphen) in support emails.** Dashes split focus and make complex ideas feel fragmented. Use periods and new sentences instead. Example: "Notion changed their export format. Page emoji now lives in a `data-emoji` attribute." not "Notion changed their export format — page emoji now lives in a `data-emoji` attribute."

## Slash commands (`.claude/commands/` and `.claude/skills/`)

- `/trio` — force a trio review on any task.
- `/triage-feedback`, `/spec-draft-pr`, `/implement`, `/review-pr`, `/changelog`, `/weekly-retro`, `/support-reply` — trio workflow.
- `/check`, `/pr-checks`, `/deploy-status` — local + remote status.
- `/tdd`, `/add-tests`, `/security-audit`, `/verify-completion`, `/simplify`, `/systematic-debugging`, `/revise-claude-md` — engineering aids.
