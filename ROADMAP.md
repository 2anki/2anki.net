This is a living document that will be updated over time.

Mission: give people the simplest, fastest way to turn what they're studying into beautiful Anki flashcards. Scale 2anki.net past 300K users.

🟢 = shipped | 🟡 = in progress | 🔴 = planned

---

## Phase 1 — Core conversion + user experience

- 🟢 Notion → Anki conversion via toggle lists, nested bullets, markdown, xlsx, HTML, CSV, PDF, PPT
- 🟢 Notion OAuth integration with page picker and block walking
- 🟢 Upload-based conversion (drag-and-drop any supported file, get `.apkg` back)
- 🟢 Cloze deletion, basic, input, and reversed card types
- 🟢 Image, audio, and embed support in cards
- 🟢 Per-user card options (cherry picks, strikethrough tags, max-one-toggle, etc.)
- 🟢 Stripe subscription billing with free-tier limits
- 🟢 Pre-upload file validation with guided error messages
- 🟢 Friendly Python conversion errors instead of raw crash output (#2100)
- 🟢 Upgrade CTA when free-tier limit is hit (#2101)
- 🟢 Magic link login
- 🟢 Register form simplification
- 🟢 Migrate from npm to pnpm workspace
- 🟢 Express 5 upgrade

## Phase 2 — Ankify, observability, and growth

### Ankify (Hosted Anki — bidirectional Notion ↔ Anki sync)

- 🟢 Remote Anki Client containers with noVNC in the browser
- 🟢 Notion polling at 5-min cadence with conflict detection
- 🟢 Find-pages picker with two-tier cache (<200ms warm)
- 🟢 Nested decks per page, page icons, sync mappings
- 🟢 Access gated on `users.patreon` (lifetime) instead of hard-coded emails
- 🟢 Security hardening slice 1: token-gated session URLs, cookie binding, private host ports
- 🟢 Security hardening slice 2 (partial): CapDrop ALL, no-new-privileges, Tmpfs, AnkiConnect API key
- 🟡 Security hardening slice 3: ephemeral `/data` (tmpfs) — blocked on companion RAC image fix
- 🔴 Security hardening slice 4: operator audit log + weekly publish (~0.5d)
- 🔴 Security hardening slice 5: `/privacy/ankify` page (copy drafted)
- 🔴 Security hardening slice 7a: host-level LUKS encryption on Hetzner (~4h + downtime)
- 🔴 Security hardening slice 6: gVisor runtime (defense in depth)
- 🔴 Security hardening slice 7b: KMS-keyed per-tenant volumes (after first paying user)
- 🔴 Notion webhooks with per-subscription secrets and auto-registration (polling carries the story today; see `Documentation/ankify/notion-webhooks-deferred.md`)

### Observability + ops

- 🟢 Internal `/ops` dashboard with inbound/outbound call volume, latency, error rates (Recharts)
- 🟢 Instrumented HTTP via `instrumentedAxios` with SSRF guard, DNS pinning
- 🟢 Business metrics: signups, active users, MRR, churn, cancellation feedback
- 🟢 Conversion success/failure metrics (#2112)
- 🟢 Cancellation reasons + comments collection (#2082)

### APKG import (reverse flow)

- 🟢 Upload `.apkg` → Notion page tree with toggle-list flashcards (#280)
- 🟢 Support for `collection.anki2`, `collection.anki21`, and zstd-compressed `collection.anki21b`
- 🟢 Media upload to S3 with embedded images in Notion blocks

### PDF export

- 🟢 Deck-to-printable-PDF export, gated to subscribers and lifetime members

### Documentation

- 🟢 Docs overhaul: restructured IA (Start here / Make better cards / Sync / When something breaks / Reference)
- 🟢 8 new documentation pages with tier markers
- 🟢 Pricing copy rewrite in buyer language

### Growth (current priority)

- 🟢 SEO landing pages (`/notion-to-anki`, `/quizlet-to-anki`, `/markdown-to-anki`, `/pdf-to-anki`) — shipped
- 🟢 Signup-origin tracking (`users.signup_origin`) — shipped
- 🟢 Prerendered static HTML for landing pages — shipped (`web/scripts/prerenderLandingPages.ts`)
- 🟢 `sitemap.xml` and `robots.txt` — shipped

## Phase 3 — Scale to 300K

- 🔴 Retention experiments informed by cancellation feedback (top themes: "I don't use it enough", "I finished what I needed")
- 🔴 Blog at `/blog` for SEO content (deferred until landing pages prove the channel)
- 🔴 More integrations (Quizlet export improvements, Obsidian, Google Docs)
- 🔴 Per-locale landing pages (i18n)
- 🔴 Full HTML → Notion rich text conversion (tables, code blocks, LaTeX) for APKG import v2

## Parked ideas (issue backlog folded in 2026-08-21; the surface-lifecycle gate allows one new surface at a time)

- 🔴 AI-native fallback for unrecognized upload formats — magic-byte sniffing, known formats keep deterministic parsers, everything else falls through to the vision/AI path instead of a flat reject (was #3833; generalizes the shipped PDF-vision fallback)
- 🔴 Contextual structure interview — when a conversion's yield disagrees wildly with the page's block census, ask one evidence-based question at the result screen and record the answer as that page's parser rules (was #3949; per-page, never per-account)
- 🔴 Resumable or direct-to-storage upload for very large exports — the browser-side half of the large-export incident; Safari dies on a ~643MB multipart POST before any server cap applies (was #3957; server-side extraction already bounded by #3956)
- 🔴 Re-record the walkthrough videos against the v2 UI — recording task for the maintainer; the written docs are current, the home/start-here videos still show the pre-v2 interface (was #4061)
- 🔴 Semester Pass one-time tier — pricing-lifecycle idea from the P2 pillar; revisit against pass-sales data (was spec PR #3621; passes shipped as day/week passes instead)

---

## Current numbers

Live numbers are NOT tracked here — the maintained business baseline is the dated block in CLAUDE.md (weekly-retro updates), and dollar figures read off the Stripe dashboard (MRR is deliberately untracked, decision 2026-07-19).

See `Documentation/retros/` for weekly retro history.
