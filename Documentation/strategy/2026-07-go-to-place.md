# 2anki.net — Strategy: the go-to place for making Anki flashcards

Written 2026-07-17 from a full read of this repo and a competitive sweep of the 2026 Anki-tooling
market. Revised 2026-09-11: the user-count and revenue targets, the weekly allocation quota, and
the metrics tables were retired with the goal rewrite in `CLAUDE.md`. What remains is the
positioning, the diagnosis, and the pillar verdicts — the parts that stay true without a number
attached. Live numbers are read from `/ops`, never from this file.

---

## 1. The goal

Be the go-to place on the web to create beautiful Anki flashcards, fast and easy. Drop something
in, get a clean deck back. Every change is checked against those three words — simpler, faster,
more beautiful — and nothing else.

## 2. Where we stand

Three facts dominate everything else:

1. **Most churn is lifecycle, not price.** "I finished what I needed" and "I don't use it enough"
   lead every cancellation read; "too expensive" is marginal. 2anki is bought as a one-and-done
   utility, and a monthly subscription structurally bleeds against that.
2. **Acquisition surfaces already exist.** 40+ SEO landing pages, sitemap, `llms.txt`,
   prerendering, signup-origin tracking, a landing-page-yield ops tab, a hosted MCP server and a
   native iOS/Mac app are all shipped. "Ship more landing pages" is not the unlock; fidelity and
   speed on the pages that exist is.
3. **The native app is the only channel that ever bent the curve**, and it parses on-device —
   activation there needs client events, not server tables.

**Assets nobody in the market matches:** the broadest input coverage (native Notion API + PDF,
docx, pptx, xlsx, Markdown, HTML, CSV, EPUB, Kindle, Quizlet, images, `.apkg` re-import), a full
Anthropic-powered AI stack (deck generation, photo-to-deck, image occlusion, chat, AI note-type
generation), a Swagger-documented API (`/api/docs`), a standalone Python `.apkg` builder
(`create_deck/`), Stripe + Apple IAP billing, an open-source MIT codebase, the #1 Google result for
"notion to anki", and a shipped native app with on-device parsing.

**Market context:** in February 2026 Anki's creator began transitioning Anki's business operations
and open-source stewardship to AnkiHub (the AnKing team). The ecosystem is consolidating around an
entity whose business is *collaborative decks and med-school subscriptions* — not conversion.
2anki's "on-ramp into Anki from every other tool" position is complementary, not competitive.

## 3. Diagnosis

Being the go-to place means being the obvious answer on three surfaces:

- **Search** — largely built. The head terms with real volume ("ai flashcard generator", "pdf to
  anki", "quizlet to anki") are where Anki-Decks, Ankify.app, StudyGlen and MedAnkiGen live;
  2anki ranks #1 only for "notion to anki". The work is authority and fidelity proof
  (side-by-side output comparisons — card fidelity is the differentiator vs AI-slop
  competitors), not more pages.
- **The app stores** — the proven channel. ASO and the on-device-parsing privacy story ("your
  files never leave your device; sign in for AI") are the levers. Executes in
  `Laer-Smart/2anki.app`.
- **The AI assistants** — demand is migrating: "make me flashcards from this PDF" is increasingly
  typed into ChatGPT/Claude, not Google. Every other Anki MCP server is a local AnkiConnect
  bridge that needs desktop Anki running; 2anki's hosted MCP server is the only
  document→deck service inside the assistants.

Underneath all three: the deck has to come out clean. A beautiful deck from a messy input is the
product; everything else is distribution for it.

## 4. Pillars and verdicts

| Pillar | Verdict (2026-08-21, tracking moved here from issues #3683–#3689) |
|---|---|
| P0 Instrumentation | ✅ Shipped (#3682): funnel events, `input_format` segmentation (#4088), MCP + native attribution (#4094) |
| P1 "Anything → Anki" positioning | Open. Format breadth largely shipped (PPT, DOCX, images route to vision); AnkiHub-era positioning/outreach not started. Was #3683 |
| P2 Price to the lifecycle | Partially shipped: pricing v2 (2026-06-10), day/week passes, pause-instead-of-cancel (kept at review), win-back email. Semester pass parked (ROADMAP). Was #3684 |
| P3 Reasons to return | Shared-deck library REMOVED at T+28 with zero publishes (#3832); webhook sync built but unfed (`src/lib/ankify/FEATURE.md`). Was #3685 |
| P4 Hosted MCP server | ✅ Shipped (#3686), KEEP verdict at T+30. Listed on Smithery and mcp.so; Anthropic Connectors Directory and the official MCP Registry remain owner-only steps (facts in closed #3798) |
| P5 Developer API tier | ❌ REMOVED at adoption review 2026-08-21 (one external key, used once). Was #3687/#3780 |
| P6 Native app | Executes in the `Laer-Smart/2anki.app` repo. Was #3688 |

Per-pillar issue tracking ended 2026-08-21; new work gets fresh, scoped issues. The surface
lifecycle gate in `CLAUDE.md` (one new surface at a time, keep-or-remove at T+30) is what keeps
this table honest.

## 5. Risks

- **AI cost exposure** on free MCP traffic — metered by the existing card caps and the per-user
  spend alert / daily runaway breaker (#4357); prompt caching is in place.
- **Platform dependence:** Notion API changes, Apple review, MCP spec churn — the multi-format
  breadth and open-source core hedge this.
- **AnkiHub becomes a competitor** (ships its own converter) — owning the migration pages and
  moving first on the partnership is the defense; worst case 2anki still owns the non-med
  segments (languages, law, general).
- **Focus:** one maintainer + an agent trio. The surface-lifecycle gate is the commitment device.

*Repo anchors: pricing `src/usecases/checkout/pricingV2.ts` · quotas `src/usecases/users/CheckMonthly*`
· AI `src/lib/claude/ClaudeService.ts` · API docs `src/config/swagger.ts` (`/api/docs`) · sync design
`Documentation/ankify/`.*
