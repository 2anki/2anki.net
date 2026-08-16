# CLAUDE.md

This package lives inside the `2anki/server` monorepo as a pnpm workspace. The package name is `2anki-web` and it sits at `web/` relative to the repo root. Commands below assume cwd is `web/`; from the repo root, prefix with `pnpm --filter 2anki-web` (e.g. `pnpm --filter 2anki-web test`).

## Git

- Use conventional commit prefixes (feat:, fix:, chore:, refactor:, test:, docs:, style:)
- Suggest a branch name before starting any code changes
- Always rebase on origin/main before creating a new branch or opening a PR

## General

- Never start the dev server yourself — ask the user to run `pnpm dev` (from repo root: starts server + web together; from `web/`: web only) and report back
- A `web/.env` is required for vite — `REACT_APP_*` vars used in source must be declared (empty value is fine if unused). Missing vars surface as `ReferenceError: process is not defined` at runtime
- Prefer simple and obvious — do not deduplicate until a pattern has appeared at least three times
- Do not add comments — use meaningful names instead
- Before considering a task done, remove any scaffolding, debug logs, or temporary code added during implementation

## Package manager

- Use `pnpm`, not `npm` or `yarn`. The lockfile is `pnpm-lock.yaml` and `packageManager` is pinned in `package.json`
- Examples: `pnpm install`, `pnpm build`, `pnpm test`, `pnpm remove <dep>`

## Commands

- `pnpm test` — Vitest unit tests (`src/**/*.test.tsx`)
- `pnpm test:e2e` — Playwright e2e tests (`tests/*.spec.ts`)
- `pnpm test:e2e:with-mock` — Playwright + local mock API on :2020 (Swagger at `/docs`)
- `pnpm typecheck`, `pnpm build`, `pnpm lint` (oxlint — not ESLint/Prettier/Biome), `pnpm lint:fix` (oxfmt)
- If test output is truncated, rerun to get full output
- When tests fail, provide the specific error message

## Process

- Use TDD by default for logic changes: write a failing test, verify it fails for the right reason, pass it in the simplest way, then refactor. If asked to implement without a test, confirm whether to skip it
- For UI changes, ask the user to do a visual check before marking the task done — type-checks and test suites verify correctness, not feature correctness
- Only mock external dependencies (HTTP calls, third-party APIs) — not internal components
- A passing test suite is not proof of correctness — before committing, review affected user flows in the codebase to check for regressions

## Architecture

- Pages live in `src/pages/<PageName>/` and are lazy-loaded from `src/App.tsx`
- Shared page containers, design tokens, and buttons live in `src/styles/shared.module.css`
- Reusable form components live in `src/components/`
- Prefer `get2ankiApi()` / `src/lib/backend/Backend.ts` for API calls — a couple of legacy components still use `fetch` directly, but new code should not
- For in-app navigation use React Router's `navigate` / `<Link>`, not `window.location.href` (reserve full-page reloads for flows like logout)

## Non-obvious gotchas

- **Playwright routes match in reverse registration order.** If you need a catch-all `**/api/**`, register it *first* so specific mocks registered after it take precedence
- **`saveValueInLocalStorage(key, value, pageId)` is a NO-OP when `pageId` is truthy.** The inline comment in the source is misleading — page-scoped values are only persisted by `get2ankiApi().saveSettings`, not by the field `onChange` handlers
- **The shared `.page` class (`styles/shared.module.css`) has no vertical gap and is not a flex container** — just max-width + padding. A page that stacks multiple `.sectionCard`s needs its OWN `.page` that `composes` the shared one and adds `display: flex; flex-direction: column; gap`. Do not "simplify" a local flex-gap `.page` down to the bare shared class — the cards collapse flush together (this regressed `/photo-to-deck` in #2748 and again later; the local `.page` carries a comment saying so)
- **A new page route in `App.tsx` also needs an entry in the SERVER's `src/routes/knownRoutes.ts` (repo root, not under web/).** Without it the SPA renders the route on client navigation but a direct load or refresh of that URL 404s (the server-side known-route list gates which paths serve `index.html`). Add the path to both in the same PR, and `curl` the new URL after deploy to confirm it doesn't 404. Bit #3528 and #3542.

## Security

- IMPORTANT: Use `== null` to check for absent values — not `!value`, which incorrectly rejects falsy values like `0` or `''`
- Validate user input at the form boundary before sending to the backend
- Never log sensitive data (tokens, passwords, emails). Use `data-hj-suppress` for PII that must appear in the DOM
