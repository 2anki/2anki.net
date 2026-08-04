# Changelog

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
