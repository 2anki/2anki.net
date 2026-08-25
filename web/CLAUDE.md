# CLAUDE.md

This package lives inside the `2anki/server` monorepo as a pnpm workspace. The package name is `2anki-web` and it sits at `web/` relative to the repo root. Commands below assume cwd is `web/`; from the repo root, prefix with `pnpm --filter 2anki-web` (e.g. `pnpm --filter 2anki-web test`).

## Gotchas that differ from the server side

- A `web/.env` is required for vite — `REACT_APP_*` vars used in source must be declared (empty value is fine if unused). Missing vars surface as `ReferenceError: process is not defined` at runtime
- `pnpm test:e2e` — Playwright e2e tests (`tests/*.spec.ts`)
- `pnpm test:e2e:with-mock` — Playwright + local mock API on :2020 (Swagger at `/docs`)
- `pnpm lint` is oxlint and `pnpm lint:fix` is oxfmt — not ESLint/Prettier/Biome

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

- Validate user input at the form boundary before sending to the backend
- Never log sensitive data (tokens, passwords, emails). Use `data-hj-suppress` for PII that must appear in the DOM
