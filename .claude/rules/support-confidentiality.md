# Support confidentiality

Bug reports, support emails, and feedback frequently arrive with the reporter's name, email, Notion workspace name, deck titles, and other identifying detail. None of that goes into anything public.

| Requirement | Do instead | Why |
| --- | --- | --- |
| Do not put a reporter's first or last name in a commit message, PR title, PR body, GitHub issue, code comment, FEATURE.md, spec, or changelog entry. | Use the numeric user ID (`user 21770`), the role ("a returning Notion user"), or "a real user this week." | The commit goes into `main`'s history forever; the PR is world-readable. People sharing a bug with support do not consent to becoming a public artifact. |
| Do not put the reporter's email address, Notion workspace name, deck title, or any other content from their account in a commit, PR, issue, or doc. | Strip it. If a specific example is load-bearing, use a fabricated stand-in (`"Week 18: Polarised Lenses"` becomes `"a recent Notion page"`). | Workspace names and deck titles routinely contain the user's name, employer, school, or coursework. |
| Do not put an **uploaded file's original filename** (PDF/HTML/zip/apkg name) or the document's visible title/subject in a commit, PR, issue, or doc — even when quoting DB rows (`uploads.filename`, `jobs.title`) during investigation. | Describe the shape instead: "a multi-page study-guide PDF", "a text-heavy upload". | A filename is a deck title wearing a different hat — same exposure (coursework, school, employer, sometimes the person's own name in the file). It's easy to miss because a raw filename doesn't read as "personal" the way a name or email does — 2026-07-23 (issue #3804) shipped a reporter's exact PDF filenames and study-topic title into a public issue during a root-cause writeup, caught and scrubbed after the fact. |
| Do not paste a reporter's screenshot, email, or message body into a commit/PR/issue. | Reference the support inbox ("matches the toggle-with-table report in the inbox") without quoting. | Screenshots leak the same identifiers plus more (study material, handwriting, faces). |
| Do not reference an internal Linear/issue tracker ID, support ticket ID, or message thread ID that ties back to a named user in a public artifact. | If you need a reference, paraphrase the symptom. | Same exposure pattern as the name itself. |
| Do not write reporter names into `Documentation/specs/*.md` even if the spec is "draft-only." | Anonymize before the file lands in a branch. Specs end up in PRs and git history just like code does. | The lifecycle policy lets specs sit in `Documentation/specs/` for several days, fully public, before `/implement` removes them. |

## Where reporter detail is okay

- Local files outside the repo: `~/Downloads/reply-<name>.txt`, `~/Downloads/*.eml`, anything the user keeps offline.
- Never the harness memory (`~/.claude/projects/.../memory/`): it loads into every later session and nobody reviews it. No names, emails, workspace names, deck titles or filenames there; a numeric user ID at most.
- The conversation with Al inside Claude Code — explaining what you found is the point of the conversation.
- The drafted support reply itself — that obviously goes to the reporter.
- Private support tooling (the inbox, Stripe customer record, Postgres) — Al's eyes only, not public.

## Why "user 21770" instead of "an anonymous user"

A numeric ID lets Al and future-you reconcile the artifact back to the original report without exposing identity. "An anonymous user" is fine for a changelog entry but loses the trail for engineering work. Pick the level of detail to match the audience:

- Commit body / PR body / inline code: numeric ID is plenty.
- Changelog entry / blog post / public docs: "a user", no ID.
- Spec / FEATURE.md / RULES.md / READMEs: role or symptom only ("returning Notion user with an expired session"), no ID and no name.

## When you slip up

You will sometimes draft something with a name in it. The fix sequence:

1. Editable artifacts first (`gh pr edit <n> --body ...`, GitHub issue body, draft spec) — those are one command away.
2. Merged commits on `main` are harder. Force-pushing `main` to scrub a name is destructive and visible to every contributor; flag the slip to Al and let him decide whether the rewrite is worth it. Default answer is usually "no, leave it, do better next time."
3. If the slip points at a recurring hole, capture the anonymized lesson in a repo doc (this rule, or the relevant `.claude/rules/*`), not a memory file, so every agent on every machine sees it (see `## Memory & sensitive data` in CLAUDE.md).
