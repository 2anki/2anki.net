# Spec: Note-level content-hash mod for signed-in re-imports

### Trio synthesis
- PM: edit-preserving re-upload spec; drop the issue's proposed `content_hash` column — reuse the existing `fingerprint` already packed into `card_guids.source_page_id`, add only `content_changed_at`; treat the duplicate-guid fold-in as a regression test, not new logic; proposes a `reimport_notes_preserved` usage event as the leading indicator.
- Designer: no UI surface needed — the server has no view into the user's live Anki collection at export time, so it can never honestly claim "kept your edits" on the download screen. Ships as a changelog entry instead (copy below).
- Engineer: confirmed genanki's `Note.write_to_db` hardcodes one export-wide `mod` timestamp with no per-note hook; recommends a subclass (`N2ANote`) mirroring the shipped `N2AModel` pattern from #4447. Confirmed the duplicate-guid fold-in is substantially already covered by `resolveUploadIdentityGroup`. Effort: M.
- Agreement: all three converge on scope reduction — reuse `fingerprint` as the content hash, treat duplicate-guid handling as a test to confirm rather than logic to build, no UI change.
- Conflict: the engineer's own "migration shape" section listed a new `content_hash` column, which contradicts their own claim-4 finding (fingerprint already covers it) and the pm's explicit call to drop it. **Resolved in the pm's favor** — one new column (`content_changed_at`), not two.
- Resulting plan: migration adds `content_changed_at` only; TS compares stored vs incoming `fingerprint` and resolves the mod value, injecting it into `deck_info.json` as `card.mod` (the same channel `explicit_guid` already uses); Python's new `N2ANote` subclass consumes it; a changelog entry ships, no UI change.

**Outcome**: A signed-in user who edits a note inside Anki, then re-uploads the same file, keeps their edit — Anki no longer overwrites it. Verified by a twice-import fixture test: edited notes survive, content-changed notes update. Ships a `reimport_notes_preserved` server-emitted usage event (per signed-in re-upload: count of guid-matched notes whose mod was held vs bumped) so the re-upload path becomes measurable at the day-7 prod check.

**Goal alignment**: More beautiful / more trustworthy — a re-upload stops destroying study work, protecting the paying re-uploader relationship (22% of owners re-upload the same deck name). Metric: held-vs-bumped ratio from the new event, read at day-7 prod check.

**Problem**: Re-uploading the same deck overwrites edits made inside Anki, because every genanki note is stamped with export time and Anki updates any guid-matched note whose incoming mod is newer. 22% of owners re-upload the same deck name — a paying-user path — so this silently clobbers real edits for roughly one in five returning uploaders.

**Riskiest assumption**: Seeding `content_changed_at` on the first post-deploy pass does not skip parser-improvement updates for returning users — i.e. we can tell "user edited this in Anki" apart from "our parser now emits better content" without freezing legitimate content updates.

**Smallest test**: Import a fixture deck, simulate an in-Anki edit on one note, re-import twice; assert the edited note's mod is not bumped (edit survives) while a note whose source content actually changed gets a newer mod (update lands). Jest for the TS ledger/fingerprint comparison, pytest for the Python export half. Runs before any migration.

**What this removes**: The issue's proposed separate `content_hash` column. `cardFingerprint` (sha256 of front+back, already stored in `card_guids.source_page_id` as `sourceKeyHash:fingerprint` since #4388) already is that content hash — reuse it, add only the `content_changed_at` timestamp the mod value needs.

**Primary action**: Re-import an edited deck without losing Anki edits. No new UI, no toggle.

**Default behavior**: Signed-in, eligible-format (markdown/HTML/CSV/xlsx) uploads get edit-preserving mod automatically. Anonymous uploads have no ledger and keep current always-newer behavior — unchanged.

**Surface vocabulary**: No visible surface. Internal to the `u:` upload-identity ledger (`card_guids`) shipped in #4388; matches its vocabulary exactly.

**Scope**:

In —
- Migration: add `content_changed_at timestamptz null` to `card_guids`; kanel regen in the same PR (hard rail — migration-reviewer required).
- `CardGuidLedgerRepository`: read/write `content_changed_at`; seed to now on first sighting under the new scheme; bump only when the stored fingerprint differs from the incoming one.
- Reuse the existing `fingerprint` (already packed in `source_page_id`) as the content digest — no new hash column.
- Resolve the per-note mod value in TS and inject it into `deck_info.json` as `card.mod`, the same channel `explicit_guid` already uses (`create_deck.py:240`).
- `N2ANote(Note)` subclass in Python overriding `write_to_db` to substitute `int(self.mod)` for the notes-row mod when present, keeping card-row mod as export timestamp. Mirrors the shipped `N2AModel` pattern (`create_deck/helpers/n2a_model.py`).
- Changelog entry (below) — the sole user-facing artifact.

Out —
- A new `content_hash` column (redundant with `fingerprint`).
- Anonymous uploads, the Notion sync path (Notion UUID rows), and notetype mod (#4447 already pinned it).
- Any user-facing UI, setting, or copy beyond the changelog.
- Extending edit-preservation to the Notion sync path.
- Surfacing a "N edits kept" counter on the download screen (designer: the server can't verify this truthfully at export time).

**User story**: As a signed-in student who fixed a typo on a card inside Anki, I want to re-upload my updated notes file so that my new cards import without wiping the fix I made.

**Acceptance criteria**:
- [ ] Re-importing an unchanged file a second time bumps zero note mods; edited-in-Anki notes survive.
- [ ] A note whose source front or back changed gets a newer mod and updates in Anki on re-import.
- [ ] The first re-upload after deploy seeds `content_changed_at`, updates once, then stays quiet until content changes.
- [ ] Anonymous and Notion uploads are byte-for-byte unchanged.
- [ ] The migration ships with kanel regen in the same PR, with migration-reviewer sign-off recorded.
- [ ] The identical-front/different-back guid pairs (5 of 185 sampled decks) resolve to two surviving notes on re-import, with no second-note-wins overwrite.
- [ ] Changelog entry ships in the same PR (copy below).

**Open questions**:
- Confirm `fingerprint` is populated for all in-scope rows, including any pre-#4388 legacy `u:` rows. If legacy rows lack a fingerprint, the seed-on-first-sight rule must treat a missing fingerprint the same as a first sighting, so their first post-deploy re-import doesn't false-bump or false-hold.
- `deck_info.json` today only carries `card.mod` for the eligible-format upload path — confirm the field doesn't collide with any existing consumer of that JSON (batch/MCP paths) before wiring it through.

**Out of scope (next iteration)**: Extending edit-preservation to the Notion sync path; surfacing "N of your edits were kept" feedback to the user on re-upload.

## Design notes

**User moment**: A signed-in learner uploads a deck, imports it into Anki, edits some cards directly in Anki, then re-uploads the same source file later to pick up new material. Today every card in the fresh `.apkg` carries a newer timestamp, so Anki silently discards the edits. The user's fear at re-import is exactly this: "will this wipe what I changed?"

**Verdict: no user-visible surface.** This ships as invisible plumbing, with no change to the success/download screen. Two reasons:
1. The server can't truthfully report what a reassuring line would claim — at export time it has no view into the user's local Anki collection, only which *source* notes changed since last upload. "12 cards kept your local edits" would be a lie whenever the user edited nothing locally.
2. The fix makes re-import behave the way users already expect; a per-note counter on the success screen adds cognitive load to a mechanism most users never think about and can't verify.

**Copy (changelog only)**:
- Title: `Re-uploading a deck keeps your Anki edits`
- Body: `Upload the same deck again and cards you edited inside Anki stay as you left them. Only cards you changed in the original notes get updated.`

## Technical pre-flight

**Verified claims** (all confirmed against source):
1. `create_deck/create_deck.py:248-250` constructs `Note(model, fields=fields, sort_field=card["number"], tags=tags, guid=guid, due=position)` — no `mod` argument; genanki's `Note.__init__` has no such param.
2. **Central obstacle, confirmed.** Vendored genanki `note.py:159` hardcodes `int(timestamp)` for every note's `mod` column; `timestamp` is one value threaded uniformly from `Package.write_to_file` through `write_to_db`. No public per-note hook exists.
3. `genanki.Model.to_json(self, timestamp, deck_id)` emits `"mod": int(timestamp)`, and #4447 already overrides it in `N2AModel.to_json` (`n2a_model.py:75-85`, `data["mod"] = NOTETYPE_MOD`). `Note` has no `to_json` — it writes SQL directly — so the override target differs, but the subclass-and-pin pattern transfers directly.
4. **Fold-in substantially already covered for the `u:` path.** `resolveUploadIdentityGroup` (`uploadCardIdentity.ts:192`) already assigns distinct guids to identical-front/different-back cards via ordinal suffix + fingerprint-keyed `guarded` guid; `cardFingerprint` + `packIdentitySource` already persist the fingerprint in `source_page_id`. The "second note wins" collision the issue cites is the separate *content-guid* path (`create_deck.py:246`, anonymous/Notion) — out of scope here.

**Layers touched**: `data_layer` (migration + kanel `CardGuids.ts` + `CardGuidLedgerRepository`), `lib` (`DeckParser.ts`, `uploadCardIdentity.ts`, `guidLedgerTypes.ts`, `collectIssuedGuids.ts`), `services` (`UploadService.ts`), and Python (`create_deck.py` + new `helpers/n2a_note.py`). No routes/controllers/usecases/web changes.

**Per-note mod approach**: Add `N2ANote(Note)` overriding `write_to_db` to substitute `int(self.mod)` for the notes-row mod when set (card-row mod stays export timestamp). Self-contained, no apkg re-zip, mirrors the shipped pattern. Rejected: post-processing the generated `collection.anki2` sqlite after genanki writes it — reopening/rewriting the db and re-zipping the apkg is fragile and slower.

**Cross-language boundary**: `content_changed_at` resolution happens entirely in TS (reuse `cardFingerprint`, compare stored vs incoming). TS injects the resolved integer mod as `card.mod` in `deck_info.json` — the exact channel that already carries `explicit_guid`. Python stays dumb: reads `card.get("mod")`, passes it to `N2ANote`.

**Migration shape**: `content_changed_at timestamptz null` on `card_guids`. No new index — reads are by the existing `(owner, block_id)` unique. `reissue().merge([...])` must add the column. Kanel regen in-PR.

**Effort: M** — cross-language coordination plus a hard-rail migration, but the guid-injection channel, fingerprint, and subclass pattern all already exist. Not L because the process boundary needs no new plumbing.

**Concerns for migration-reviewer**: Hard-rail migration, sign-off required. Riskiest: seeding must not skip legitimate parser-side content fixes for returning users (same bump-semantics question #4447 faced for notetype mod). Test: re-import a fixture twice — edited notes survive, content-changed notes update once then go quiet. Nullable column keeps pre-deploy rows and the anonymous/Notion paths unaffected.

**Files in play**: `migrations/<ts>_add_content_changed_at_to_card_guids.js`, `src/data_layer/public/CardGuids.ts`, `src/data_layer/CardGuidLedgerRepository.ts`, `src/lib/anki/uploadCardIdentity.ts`, `src/lib/anki/guidLedgerTypes.ts`, `src/lib/anki/collectIssuedGuids.ts`, `src/lib/parser/DeckParser.ts`, `src/services/UploadService.ts`, `create_deck/create_deck.py`, `create_deck/helpers/n2a_note.py`.
