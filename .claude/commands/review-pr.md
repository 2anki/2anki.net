---
description: Review a contributor PR against repo conventions and goal alignment
argument-hint: <pr-url-or-number>
---

Three parallel reviewers fan out, each focused on one axis. You synthesize and post a single review comment.

## Step 1 — gather context (single call, in your own context)

- `gh pr view <n> --json title,body,author,additions,deletions,changedFiles,files,baseRefName,headRefName,labels,isDraft,mergeable,statusCheckRollup`
- `gh pr diff <n>` — capture full diff
- If the PR touches `web/src/**` or `src/services/EmailService/templates/**`, mark `userFacing = true`. Otherwise `userFacing = false`.

Do not read the changed files yourself — the forks will. Reading them now wastes context you won't reference again.

## Step 2 — fan out three forks in **one** message

Call `Agent` three times in a single message (no `subagent_type` — fork yourself). Each fork inherits the prompt cache, runs in its own context, returns a focused report.

**Fork A — security**
```
You are reviewing PR #<n> against `.claude/rules/security.md`. Pull the diff with `gh pr diff <n>` and the file list with `gh pr view <n> --json files`. Read only the files the diff touches.

Check exclusively for:
- knex.raw with string concatenation / template interpolation
- User-controlled URL → axios/fetch without instrumentedAxios
- Unsanitized HTML rendered to the user (sanitize-html bypass)
- Path traversal in upload / zip extract paths
- New `process.env` reads without a boot-time guard
- JWT secret fallbacks, bcrypt cost factor changes
- Webhook signature verification on raw body (Stripe, Notion)
- Auth check moved into a controller from middleware
- Raw errors / stack traces leaked to res.send
- New Math.random for IDs (Sonar S2245 — use crypto.randomUUID)

Output under 200 words. **Evidence gate — every finding must clear it before you list it:**
1. Quote the verbatim line you're reacting to, copied from `gh pr diff <n>`. If you can't quote it, it doesn't exist — drop it.
2. Score your confidence 1–10 that this is a real issue on the line you quoted (not a guess about code you didn't see).
3. Findings under 7 go in the **Low confidence** bucket, never in Blocking. A speculative "this might break if…" without a quoted line is a 0 — omit it.

Format:
- **Blocking** (confidence ≥ 7) — each bullet: `file:line` · the quoted line · the fix
- **Nits** (confidence ≥ 7) — bullet list
- **Low confidence** (< 7) — one line each, no fix; the synthesizer decides whether to surface
- **No issues** if clean. Don't pad.
```

**Fork B — engineering**
```
You are reviewing PR #<n> against `.claude/rules/code-quality.md` and `.claude/rules/testing.md`. Pull diff and files yourself.

Check exclusively for:
- Layer violations (route/controller doing service work; knex outside data_layer)
- `any`, `as any`, `@ts-ignore` without a justification comment on the same line
- Comments that explain WHAT code does (suggest rename instead)
- New public function / route / use case without a `.test.ts` next to it
- Mocked internal collaborators (only HTTP / SDKs / fs may be mocked)
- Scope creep — refactors bundled with feature work
- Hot-path performance (anything in `src/lib/parser/`, `src/services/NotionService/`, `src/lib/ankify/`)
- Stacked PRs (head branch not off main)
- `setInterval` / `setTimeout` at module top-level
- Lead-with-positive: `if (!ready) {...} else {...}` (Sonar S7735)

Output under 200 words. Same format as Fork A.
```

**Fork C — ux / voice** (only if `userFacing = true`; otherwise skip this fork entirely)
```
You are reviewing PR #<n> against `VOICE.md` and `.claude/docs/email-templates.md`. Pull diff and files yourself. Read only files under `web/src/**` and `src/services/EmailService/templates/**`.

Check exclusively for:
- Banned words (awesome, amazing, oops, please feel free, leverage, seamless)
- Exclamation marks in product UI / emoji in product UI
- Generic error strings ("An error occurred") — should be specific + actionable
- Sentence case on buttons / headings
- "my" in button labels ("Verify my email" → "Verify email")
- Numbers using comma thousands separator (use thin space)
- Trailing period on one-line entries in `web/src/pages/WhatsNewPage/changelog/*.json`
- Implementation-detail leaks in changelog entries (file names, class names)
- Email template missing mascot header / dark-mode block / responsive block / footer tagline
- Capitalized brand names (Anki, Notion, AnkiWeb) preserved

Output under 200 words. Same format as Fork A.
```

## Step 3 — synthesize and post

Read the three (or two) summaries. Dedupe overlapping findings. Classify:

- **Drop any finding that lacks a quoted line**, and drop the forks' **Low confidence** bucket unless a finding there is both concrete and quoted — a half-sure flag costs the contributor more than it saves. Never post a speculative finding as Blocking.
- **Blocking** if any fork flagged it as blocking — bundled, with the file:line and the suggested fix in a `suggestion` code block where possible.
- **Nits** — bundled separately, no code blocks unless trivial.
- **First-time contributor?** Check `gh pr view <n> --json authorAssociation`. If `FIRST_TIME_CONTRIBUTOR` or `FIRST_TIMER`, add one warm sentence at the top.

Post the review with:
```
gh pr review <n> --comment --body-file -
```

Pipe a single comment with this shape:
```
**Verdict**: approve | request-changes | comment-only

<one-line summary tied to the goal: simpler/faster/more beautiful, or scale toward 300K>

### Blocking
- …

### Nits
- …
```

Never use `--approve` — Alexander authors most PRs and GitHub blocks self-approval. Use `--comment` even when the verdict is "approve."

If the verdict is approve and the PR is the author's own and all `statusCheckRollup` entries are non-FAILURE, follow up with `gh pr merge <n> --squash --delete-branch`. Otherwise stop after posting.

## Notes

- The forks run in parallel — do not wait between calls. One message, three `Agent` blocks.
- If you find yourself reading changed files in your own context, stop — that's the fork's job. The whole point is to keep diff/file content out of the main thread.
- Tone in the posted comment: welcoming, specific, fast. Don't sit on the review.
