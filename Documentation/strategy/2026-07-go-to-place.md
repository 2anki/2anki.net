# 2anki.net — Strategy: the go-to place for making Anki flashcards

Written 2026-07-17 from a full read of this repo (commit `0a25214`),
`Documentation/retros/` (W19–W26), and a competitive sweep of the 2026 Anki-tooling market.

---

## 1. Where we actually are (W26, 2026-06-23)

| Metric | Value | Needed |
|---|---|---|
| Registered users | 17,861 | 300,000 (goal) |
| User growth | ~1.4%/wk | 2.7%/wk for even a 24-month path |
| Signups | 253/wk, −13% WoW | ~700/wk |
| MRR | $1,823 (+4% WoW, ARPU-driven) | $5,000 (goal) |
| Paying subscribers | 762 and sliding | — |
| New paid conversions | 16/wk | ≥70/wk (v2 target) |
| Signup→paid | ~6% | — |
| 30-day churn | 18.2% | — |

Three facts dominate everything else:

1. **~79% of churn is lifecycle, not price.** "I finished what I needed" + "I don't use it
   enough" — every single week. "Too expensive" is consistently marginal. 2anki is bought as a
   one-and-done utility; monthly subscriptions structurally bleed against that.
2. **Acquisition surfaces already exist.** 40+ SEO landing pages (15 converter pages, audience
   pages, a 15-page Q&A layer), sitemap, `llms.txt`, prerendering, signup-origin tracking and a
   landing-page-yield ops tab are all shipped. `ROADMAP.md` still lists these as 🔴 planned — it
   is stale. "Ship more landing pages" is not the unlock.
3. **The only thing that ever bent the curve was the native iOS/Mac app** (soft-launch ~31 May:
   Google OAuth ~15×, Apple ~18×, signups 114→322) — and it shipped without server-side
   instrumentation, so native activation is still a blind spot. Meanwhile the W26 retro fired two
   alarms: ~50% of effort going to process/chores, and the overdue page→checkout→paid funnel
   read never pulled.

**Assets nobody in the market matches:** broadest input coverage (native Notion API + PDF, docx,
pptx, xlsx, Markdown, HTML, CSV, EPUB, Kindle, Quizlet, images, .apkg re-import), a full
Anthropic-powered AI stack (deck generation, photo-to-deck, image occlusion, chat, AI note-type
generation), a Swagger-documented API across ~34 routers (`/api/docs`), a standalone Python
`.apkg` builder (`create_deck/`), Stripe + Apple IAP billing, an open-source MIT codebase, the #1
Google result for "notion to anki", and a shipped native app with on-device parsing.

**Market context that changes the game:** in February 2026 Anki's creator began transitioning
Anki's business operations and open-source stewardship to AnkiHub (the AnKing team). The
ecosystem is consolidating around an entity whose business is *collaborative decks and med-school
subscriptions* — not conversion. 2anki's "on-ramp into Anki from every other tool" position is
complementary, not competitive, and worth formalizing while the transition is fresh.

---

## 2. Diagnosis

The 300K/"go-to on the planet" goal fails today for three compounding reasons:

- **Leaky funnel, unmeasured.** 253 signups → 16 paid. Nobody knows where page→checkout→paid
  leaks because the read was never instrumented end-to-end (W22's "flying blind," still open in
  W26). Pouring more traffic into an unmeasured 6% funnel is waste.
- **Business model fights the user's lifecycle.** Learners convert hard for an exam cycle, then
  leave. The product punishes its own happy path: finishing your deck means cancelling.
- **Demand is migrating to surfaces 2anki isn't on.** "Make me flashcards from this PDF" is
  increasingly typed into ChatGPT/Claude, not Google. Every existing "Anki MCP server" is a
  local AnkiConnect bridge that requires desktop Anki running; nobody offers a hosted
  document→deck service inside the AI assistants. That lane is open and it maps 1:1 onto
  2anki's existing engine.

Being "the go-to place" therefore means winning three surfaces: **search** (largely built, needs
funnel fixing), **the app stores** (proven channel, needs instrumentation + ASO), and **the AI
assistants** (unclaimed, cheap to enter). Underneath all three: a pricing model aligned with how
students actually study.

---

## 3. The strategy — six pillars

### P0 — Stop flying blind (prerequisite, ~1–2 weeks)

- Pull the overdue v2 funnel read: durable server-side events for landing→upload→preview→
  download→checkout→paid, per signup-origin. The `events` table and yield repository exist;
  finish the wiring and put the read in the weekly retro template.
- Instrument native activation (only 13 of 335 W23 native signups touched server tables because
  parsing is on-device — emit client events for convert/export on native).
- Enforce the existing allocation rule ruthlessly: ≥25% of weekly shipping is acquisition, ≥1
  acquisition change/week, cap process/chore work. W26 showed the rule exists but isn't holding.

*Everything below is sequenced on this — you can't tune what you can't see.*

### P1 — Own "anything → Anki," not just "Notion → Anki"

- **Positioning statement:** *2anki is how anything becomes Anki flashcards.* Notion is one door
  among twelve, not the brand.
- The head terms with real volume are "ai flashcard generator," "pdf to anki," "quizlet to
  anki" — where Anki-Decks, Ankify.app, StudyGlen and MedAnkiGen currently live. 2anki ranks #1
  only for "notion to anki." The landing pages exist; the work is authority (blog unblocks once
  the funnel read proves page yield), fidelity proof (side-by-side output comparisons — 2anki's
  card fidelity is its differentiator vs AI-slop competitors), and conversion optimization on
  those pages.
- **Formalize the AnkiHub-era position.** Reach out to AnkiHub as the stewardship transition
  settles: 2anki as the recommended importer/on-ramp (their business is collaborative decks and
  retention; 2anki's is getting material *into* Anki). A single link from the Anki ecosystem's
  new center of gravity is worth more than a quarter of SEO work. The existing competitor
  migration pages (Brainscape, Quizlet, StudyStack, Zorbi, AnkiApp…) reinforce this "Switzerland
  of flashcards" posture.

### P2 — Price to the lifecycle instead of fighting it

79% of churn is the product working as intended. Sell the cycle, not the month:

- **Semester Pass** (~$20–25 / 4 months) between the 7-day pass and annual — matches "I
  finished what I needed" exactly. Passes and consumables infra already exist (24h/7d passes,
  Stripe + Apple IAP `daypass.24h`/`weekpass.7d`).
- **Pause instead of cancel** in the cancel flow (CLAUDE.md already mandates weighing a
  retention offer). A paused subscriber in September is a re-activation, not a re-acquisition.
- **Win-back calendar:** "finished what I needed" churners get one email at the next
  semester/exam cycle. Cheap, measurable, aimed at the single biggest churn bucket.
- Keep the v2 ARPU gains ($7.99/mo, $64/yr) — the reprice worked; the problem is volume.

### P3 — Give learners a reason to come back (and bring others)

- **Public shared-deck library.** `ShareRouter` already serves public, rate-limited deck shares.
  Turn shares into indexed, browsable pages with preview cards and a "remix this deck" CTA.
  This is the Quizlet playbook: every shared deck is a user-generated landing page. It converts
  a one-and-done user's *output* into permanent top-of-funnel, and it's the only SEO channel
  that compounds without authored content.
- **Rebuild Auto Sync on webhooks + pooled workers, and shelve the container-per-user version.**
  The retros are right to stop *selling* it — per-user Docker/noVNC caps at ~15–30 users/box and
  is blocked on at-rest encryption. But sync is the strongest recurring-value concept in the
  codebase ("your Notion changes, your deck updates"), i.e. the direct answer to lifecycle
  churn. The deferred webhook design (`Documentation/ankify/notion-webhooks-deferred.md`) plus a
  stateless re-convert pipeline serves sync *of decks* (not hosted Anki) to hundreds of users on
  existing infra, at a price point below $30/mo. Hosted-Anki-in-a-browser can wait.

### P4 — Be where the demand is moving: AI assistants (MCP)

Ship a **hosted remote MCP server** (`mcp.2anki.net`) exposing the existing engine as tools:

- `convert_to_deck(file|url|text) → .apkg download link` — wraps `/api/upload/file` + jobs
- `generate_deck(topic|document, options)` — wraps the Claude deck-generation path
- `list_my_decks`, `get_deck_preview` — wraps existing apkg meta/cards endpoints

Why this is the highest-leverage new surface:

- **The lane is empty.** All current Anki MCP servers (ankimcp, clanki, anki-connect-mcp, etc.)
  are local bridges to AnkiConnect — they require desktop Anki running and can't ingest a PDF.
  A hosted "here's my lecture PDF → here's an .apkg" tool inside Claude/ChatGPT/Cursor is
  unclaimed territory that maps exactly onto what 2anki already does.
- **It's packaging, not engineering.** OAuth + streamable-HTTP MCP over the already-Swagger-
  documented REST API; quotas map onto the existing free-tier limits (100 cards/mo, etc.);
  upgrades route through existing Stripe checkout. Estimate: 2–4 weeks.
- **It's distribution first, revenue second.** MCP directory listings, "works in Claude" /
  "works in ChatGPT" landing pages, and the existing `llms.txt` make 2anki the default answer
  when an assistant is asked for Anki cards. Free-tier MCP users are signups; conversions ride
  the same paywall.

### P5 — Developer tier: API access (the monetization question, sized honestly)

**Verdict: yes, build it — but as the second step of P4, and with modest direct-revenue
expectations.** The honest sizing:

- **Direct revenue is a niche.** Customers are study-app builders, tutoring platforms, course
  creators, and agent developers who want `.apkg` output without reimplementing genanki +
  format parsing + AI generation. Existing "flashcard API" offerings (Zyla-hub listings, small
  GitHub projects) are weak, so 2anki can own the category — but the category is realistically
  low-hundreds of customers. Expect $1–3K MRR within a year, not a hockey stick. That said,
  against a $1.8K MRR base that is a *doubling*, with near-zero marginal cost.
- **Pricing:** metered credits (1 credit = 1 deck conversion; AI generation = cost-plus on
  Sonnet's $3/$15 per Mtok, which `ClaudeService` already computes per call). Tiers: free
  100 credits/mo (same as consumer), $29/mo starter, $99/mo scale, enterprise custom.
  Stripe metered billing slots into the existing subscription machinery.
- **Engineering:** API-key issuance + per-key rate limiting + a public OpenAPI subset
  (curate the ~34 documented routers down to upload/convert/jobs/apkg/AI-generate) + a docs
  page. The Swagger spec (`src/config/swagger.ts`, `/api/docs`) means most of the documentation
  already exists. Estimate: 2–3 weeks after the MCP server (they share the key/quota layer).
- **Strategic value exceeds the revenue:** every app that builds on the API embeds 2anki as
  infrastructure ("powered by 2anki" attribution for free-tier keys), deepens the moat around
  the conversion engine, and makes the MCP story credible. It also future-proofs: if
  assistant-mediated demand grows the way it's trending, the API *is* the product.

### P6 — Double down on the proven channel: native

- Instrument first (P0), then invest: ASO (the "X to Anki" keyword family applies in the App
  Store too), screenshots/reviews loop, and the `/app` page already built in W26.
- The on-device parsing story ("your files never leave your device; sign in for AI") is a
  genuine differentiator vs every web-only competitor — market it.
- Android/Windows only after iOS activation numbers justify it.

---

## 4. Sequencing

**Now (weeks 1–4):** P0 funnel + native instrumentation · pull the funnel read · Semester Pass +
pause-instead-of-cancel · AnkiHub outreach email.

**Next (weeks 5–12):** MCP server shipped + listed in directories · shared-deck library v1
(indexable share pages) · fidelity-proof content on the head-term landing pages · win-back
emails · first funnel-driven CRO iteration.

**Later (quarter 2+):** Developer API tier (keys + metered billing + public OpenAPI docs) ·
webhook-based deck sync (Ankify v2, no containers) · blog once landing-page yield proves the
channel · Android/desktop by the numbers.

## 5. KPIs and kill criteria

- **North-star pair:** signups/wk and new-paid/wk (the goal pair: 300K users *and* $5K MRR).
- Funnel: landing→upload, upload→download, download→signup, signup→paid — read weekly per
  origin. Target signup→paid from ~6% → 10%.
- Churn: 30-day churn < 15%; % of cancels taking pause/semester offer.
- MCP/API: assistant-originated signups/wk (new `signup_origin` values), API MRR.
- Kill criteria: shared-deck library gets < 5% of organic entrances after 8 weeks → stop;
  developer tier < $500 MRR after 6 months → freeze at maintenance; any pillar that can't show
  its funnel numbers doesn't get week-2 investment.

## 6. Risks

- **AI cost exposure** on free MCP/API traffic — mitigate with credit metering from day one and
  prompt-caching (already in place).
- **Platform dependence:** Notion API changes, Apple review, MCP spec churn — the multi-format
  breadth and open-source core hedge this.
- **AnkiHub becomes a competitor** (ships its own converter) — moving first on the partnership
  and owning the migration pages is the defense; worst case, 2anki still owns non-med segments
  (languages, law, general).
- **Focus:** six pillars is a lot for one maintainer + agent trio. The allocation rule (P0) is
  the guardrail; the sequencing section is the commitment device.

---

## Pillar status (2026-08-21 — tracking moved here from GitHub issues #3683–#3689, now closed)

| Pillar | State |
|---|---|
| P0 Instrumentation | ✅ Shipped (#3682): funnel events, `input_format` segmentation (#4088), MCP + native attribution (#4094) |
| P1 "Anything → Anki" positioning | Open. Format breadth largely shipped (PPT, DOCX, images route to vision as of 2026-08-21); AnkiHub-era positioning/outreach not started. Was #3683 |
| P2 Price to the lifecycle | Partially shipped: pricing v2 (2026-06-10), day/week passes, pause offer (kept — 4 saves/60d, review 2026-08-21), win-back email. Semester pass parked (ROADMAP). Was #3684 |
| P3 Reasons to return | Verdict in: shared-deck library REMOVED at T+28 with zero publishes (#3832); webhook sync built but unfed (Notion-side registration deferred, `src/lib/ankify/FEATURE.md`). Was #3685 |
| P4 Hosted MCP server | ✅ Shipped (#3686), KEEP verdict at T+30 (37 users/30d). Directory submissions tracked in #3798's kit |
| P5 Developer API tier | ❌ REMOVED at adoption review 2026-08-21 (1 external key, used once). Was #3687/#3780 |
| P6 Native app | Executes in the `Laer-Smart/2anki.app` repo. Was #3688 |

The weekly allocation rule (one acquisition-facing change ships first, every week) lives in CLAUDE.md and remains the standing guardrail; per-pillar issue tracking ends here — new work gets fresh, scoped issues.

*Repo anchors: pricing `src/usecases/checkout/pricingV2.ts` · quotas
`src/usecases/users/CheckMonthly*` · AI `src/lib/claude/ClaudeService.ts` · API docs
`src/config/swagger.ts` (`/api/docs`) · shares `src/routes/ShareRouter.ts` · sync design
`Documentation/ankify/` · retros `Documentation/retros/W19–W26`.*
