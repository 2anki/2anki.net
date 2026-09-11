# Chat product roadmap — post PR-2262

A living doc, not an in-flight spec. The chat composer file-attachment PR (#2262) explicitly deferred, hard-cut, or out-scoped 13 items; this file is the single source of truth for what's next, what's frozen, and what won't ship.

**Status check (2026-09-11):** #13 (multipart history bug) shipped — `parseHistory` in `src/controllers/ChatController.ts` parses the stringified field. #1 (attachment persistence) shipped — `chat_attachments` table (migration 2026-08-14) and `ChatAttachmentsRepository`. #3 pins, #4 model picker, #9 page range, #11 thumbnails: not shipped, triggers unchanged. The P0/P1 sections below are kept as the record of why; treat them as done.

**Why this lives here, not in `Documentation/specs/`**: spec docs auto-graduate to implementation under the spec lifecycle (`CLAUDE.md > Spec lifecycle`). A roadmap survives across PRs and shouldn't get deleted when one of its items ships. Same pattern as `Documentation/ankify/notion-webhooks-deferred.md`.

---

### Trio synthesis

- **PM**: P0 = #13 history bug. P1 (armed) = #1 + #3. P3 = kill #5, #6, #10, #11, #12. Riskiest assumption: attachments become a habit, not a novelty.
- **Designer**: Ship order 13 → 11 → 1 → 3 → 4 → 9 → 6 → 2; drop #5; **one composer right-of-textarea control slot, ever**; pins before folders.
- **Engineer**: #1 is the spine (gates #10, #11). #13, #3, #6 are XS. #1, #10 are L. #11 has a ~3 MB `pdfjs-dist` bundle risk.
- **Agreement**: Ship #13 first. #1 is the gating critical path. #5 dies. #7, #8 stay hard-cut. #10 dies as a first-class tab.
- **Conflict**: PM "kill #11" vs Designer "free win" — resolved as P2 gated on bundle cost. PM "gate #3 on metric" vs Engineer "it's XS" — resolved as P1 with soft trigger.
- **Resulting plan**: Three explicit lanes, one design pattern committed, the bug fix jumps the queue.

---

## The committed design pattern

The composer reserves **exactly one control slot to the right of the textarea**. Today that's Send. The ceiling is `[model ▾] [Send]`. No tone preset, no temporary toggle, no third dropdown ever lands there.

- Temporary chat (if it ships) goes in the **new-chat menu**, not the composer.
- Tone presets do not ship.
- Pins ship before folders. Folders, if they ship, are a v2 grouping over pinned + unpinned — not a parallel concept.
- The chip surface (one per attachment) can grow controls (e.g., page-range popover) without spilling into the composer chrome.

This pattern is the deliverable of this roadmap as much as any individual feature. Future composer changes must check it before shipping.

---

## P0 — ship this week

### #13 Multipart history bug

When a user attaches a file, the FormData `history` field arrives as a JSON string, but the server checks `Array.isArray`. The check fails, history becomes `[]`, and multi-turn conversation context is silently dropped whenever an attachment is in play.

- **Trigger**: already broken in main. Caught by security review on PR #2262. Not a deferred item — a regression.
- **Effort**: XS (~10 LOC, one parse + try/catch).
- **Fix**: in `src/controllers/ChatController.ts`, `parseHistory`:
  ```ts
  function parseHistory(raw: unknown): HistoryEntry[] {
    let parsed: unknown = raw;
    if (typeof raw === 'string') {
      try { parsed = JSON.parse(raw); } catch { return []; }
    }
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isHistoryEntry).map((m) => ({ role: m.role, content: m.content }));
  }
  ```
- **Test**: extend `ChatController.test.ts` — happy path with stringified history + attachment passes history through; malformed JSON returns `[]`.

---

## P1 — armed; ship when the trigger fires

Two items, each with an explicit, measurable trigger. The trigger is the gate, not a guess.

### #1 Attachment persistence + reload-rehydration (PR-3b)

- **What ships**: `chat_message_attachments` table, S3 prefix `chat-attachments/`, signed-URL fetch on history load (re-signed at load time — default 15 min expiry doesn't survive cold conversation reads).
- **Trigger**: ≥20% of new chats include at least one attachment within 14 days of PR-3 landing. Instrument the metric **this week** (not the feature — just the counter).
- **Effort**: L (table + migration + S3 + signed URL rotation + rehydration code path).
- **Gates**: #10 (attachment library) and the meaningful version of #11 (cross-session thumbnails).

### #3 Pinned conversations

- **What ships**: one boolean column on `chat_conversations`, sidebar sort modification, pin/unpin action on conversation row.
- **Trigger**: either of —
  - ≥10% of users have 20+ saved chats (instrument from sidebar load), **OR**
  - support mentions "can't find my chat" three or more times in a week.
- **Effort**: XS. Ship the migration alongside any unrelated migration for the same release.
- **Note**: Engineer flagged this as overcautious deferral — same tier as the bug fix. PM's trigger holds because we don't want to ship sidebar churn before knowing the user pain is real, but the implementation cost is essentially zero once the trigger fires.

---

## P2 — this quarter, only with signal

### #11 PDF thumbnails in chip

- **Trigger**: bundle audit shows `pdfjs-dist` adds <500 KB gzipped after tree-shake, OR an alternative library exists at that cost.
- **Effort**: S frontend, with the bundle cost as the real question.
- **Why P2 not P3**: Designer called this a free trust win (sharper-looking chip, no new control). Engineer's bundle warning means it doesn't ship until the cost is measured.

### #9 PDF page-range selection

- **Trigger**: 3+ support reports of "I only needed pages X–Y of a long PDF."
- **Effort**: M for the real version (pdf-parse + page filter pre-Anthropic). XS for the cheap version (system-prompt range hint — Anthropic reads the whole PDF but is told to focus). Ship the cheap version first if the trigger fires.
- **UI**: per-chip popover. Does not expand composer chrome.

### #4 Model picker (Sonnet / Opus / Haiku)

- **Trigger**: cost or latency complaints surface in support — at least one quoted user, not a general impression.
- **Effort**: M. The schema piece (`chat_messages.model`) is cheap. Per-model billing surfacing and the rate-limit table are where the M comes from.
- **UI**: `[model ▾] [Send]` to the right of the textarea. This is the composer ceiling — no further controls land here.

---

## P3 — frozen or killed

### Killed (do not ship even if data appears to support them)

- **#5 Tone presets** ("explain like I'm new", "exam mode"). Learners pick Anki on purpose; a preset dropdown is tutorial-voice in a tool that should feel like Linear. If a user wants a tone, they type it into the prompt.
- **#10 Attachment library as a first-class sidebar tab.** Three parallel sidebar concepts (conversations + folders + library) is too much. **Alternative if reuse demand appears**: surface "recent attachments" inside the existing upload picker. That stays inside the composer flow.
- **#6 Temporary / incognito chat.** Spec's own words: "low-signal request count today." The new-chat menu is the right home if it ever ships — not the composer header — but we don't build until demand is loud.
- **#12 EXIF stripping from images.** Revisit only on a real privacy report from a real user. Pre-building privacy hardening with no signal is yak-shaving.

### Hard-cut (already dead, do not reopen)

- **#7 Audio attachments.** Anthropic can't read audio. Would require Whisper, a transcription quota, and a new abuse surface. Its own spec or nothing.
- **#8 "Any file format"** (.docx, .pptx, .xlsx, .epub). Claude can't read these natively. Pretending they "just work" ships a worse experience than the existing upload page. Chat stays PDF + images.

### Frozen (revisit only when explicit trigger fires)

- **#2 Folders for conversations.** Gated on #3 (pins) succeeding *and* the median user crossing ~30 saved chats. Folders are a v2 grouping over pinned/unpinned, not a parallel concept.

---

## The riskiest assumption

**Attachments become a habit, not a novelty.**

Items #1, #9, #10, and #11 all assume the same user pulls in PDFs or images across multiple sessions. If the 14-day attachment-inclusion rate comes in under 5%, that entire branch dies — redirect that effort to non-attachment work (the existing upload page funnel, the conversion success rate).

**Smallest test**: the instrumentation itself.
- Daily metric: `% of new chats containing ≥1 attachment` (14-day rolling).
- Cohort metric: `% of attachment-using users who attach again in week 2`.

Land the metric **this week**. Treat the 14-day rate as a kill switch on the rest of the attachments branch, not a vanity number.

---

## Ship order

1. **#13 history bug** — this week, P0.
2. **Instrument #1 trigger** — this week, alongside the bug fix.
3. **#3 pins** — when the saved-chat threshold or support-mention trigger lands.
4. **#1 persistence** — when the ≥20%/14-day attachment metric fires.
5. **#11 thumbnails** — after bundle audit, only if cost is acceptable.
6. **#9 page-range** — after 3+ support reports.
7. **#4 model picker** — after cost/latency complaints.
8. **#2 folders** — after #3 ships and median saved-chat count justifies it.

Everything else stays in P3 unless this doc is amended.
