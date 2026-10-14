# Should the server move from Node to Rust? (evaluated 2026-10-14)

**Verdict: no full rewrite.** The one place Anki's Rust core pays is the apkg writer, and that shipped as #4726 through Anki's own Python library, with no Rust toolchain.

## Why not

The case for a rewrite is throughput and memory. Neither is the constraint:

- The prod box idled at load average 0.2 across a 52-day uptime with most of its memory free. The main process sits around 300 MB RSS, conversion children peak near 1.2 GB in total.
- Conversion time goes to work outside Node: poppler (`pdftoppm`, `pdfimages`, `pdfinfo`), LibreOffice, Chromium via puppeteer, the Python packager, and the Notion and Claude APIs. A Rust orchestrator makes none of those faster.
- The two real memory incidents were glibc arenas plus tsx recompiles (#4687) and pdf.js retaining page data (#4715). Both were fixed in place.

What a rewrite would replace, counted on 2026-10-14 under `src/` (`*.ts`, tests are `*.test.ts`): 1055 non-test files holding 112k lines, plus 814 test files, 257k lines in all; 188 Knex migrations; 40 files in `src/routes/` that build an Express `Router()`; 66 non-test files importing the Notion SDK. Four integrations have no Rust SDK of equal footing (Notion, Stripe webhooks, Apple App Store server library, mammoth for docx). All of it on hard-rail surfaces that nobody reviews. It makes no flashcard simpler, faster or more beautiful, so it fails the goal check.

## Ecosystem map, for the next time this comes up

| Today | Rust | Risk |
| --- | --- | --- |
| Express | axum | low |
| knex + pg, 188 migrations | sqlx, migrations rewritten | high |
| cheerio (18 parser files) | scraper | medium |
| pdf-parse (pdf.js 1.10) | pdfium-render | medium, heuristics tuned to pdf.js |
| mammoth (docx) | docx-rs, partial | high |
| markdown-it + plugins | comrak | medium |
| sanitize-html | ammonia | low |
| puppeteer | chromiumoxide | medium |
| dockerode | bollard | low |
| @notionhq/client (66 importing files) | none, hand-rolled | high |
| @anthropic-ai/sdk | none, hand-rolled | medium |
| stripe (webhooks, checkout, subscriptions) | async-stripe, community | high |
| @modelcontextprotocol/sdk | rmcp | low |
| @apple/app-store-server-library | none | high |

## Where Anki's Rust does pay

Anki's `rslib` is the canonical apkg implementation (`Collection::export_apkg`). It is AGPL-3.0 and `publish = false`, so a Rust consumer builds Anki from source in CI. The same engine ships as the `anki` Python wheel, prebuilt. #4726 moved `create_deck/` from genanki to that wheel: decks are built in a throwaway collection and exported the way Anki desktop exports. The packager stays a separate process, so the MIT server is not a combined work.

A thin Rust CLI on `rslib` is only worth a toolchain if the Python child's startup or memory shows up as a material share of conversion time in prod logs. Measured locally the difference was tens of milliseconds per deck against a 1.7 s average conversion, so the default answer is no.
