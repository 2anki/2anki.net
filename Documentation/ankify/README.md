# Ankify (in 2anki/server)

Auto Sync — Notion → Anki sync, ported from the standalone `2anki/ankify` prototype into 2anki/server proper. Shipped as the paid Auto Sync product. Every route and UI surface is gated by `hasAnkifyAccess` (`src/lib/ankify/access.ts`): lifetime `users.patreon`, a per-user `users.ankify_access` comp grant, or an active subscription on `AUTO_SYNC_PRODUCT_ID`. The original hard-coded email allowlist is gone.

**Read `src/lib/ankify/FEATURE.md` first** — it is the maintained hot-path doc (gate, polling cadence, webhook status, reviewer rules). This file keeps the pieces that doc doesn't: domain vocabulary, source layout, the container security posture, the pending image fix, and local-dev env vars. Last full revision 2026-09-11.

**Routes (web):**
- `/ankify/setup` — first-run takeover; auto-redirects to `/ankify` once a workspace is running and AnkiWeb is linked.
- `/ankify` — workspace home. Persistent `WorkspaceBar` (Open Anki + overflow menu for Restart / Shut down). Tabs: **Decks** (subscribed Notion pages) and **Find pages** (picker + paste-a-link). Conflicts banner above the deck list when present, opens in a modal. History footer link to `/ankify/history`.
- `/ankify/history` — review tracker. Manual "Update Notion" + create-tracker wizard.

**Domain vocabulary (binding for all user-facing copy):**
- A Notion **page** becomes an Anki **deck**.
- A Notion **toggle** becomes an Anki **flashcard**.
- The word "sync" is reserved for Anki's own `Sync` button. Don't reintroduce it as a verb in our copy ("we'll keep them in sync", "sync now", etc.).

**Source layout:**

- `src/data_layer/ankify/` — repos: clients, sync_mappings, sync_logs, notion_subscriptions, sync_conflicts, **session_tokens** (slice 1), export_schedules (dead UI but live backend — see "Pending cleanup")
- `src/services/ankify/` — `RacService`, `AnkiConnectClient`, `buildAnkiConnectClient` (factory), `notionBlockChildrenFetcher` (factory), `notionPageWalker`, `AnkifyExportScheduler` (dead UI; live polling)
- `src/usecases/ankify/` — orchestration including `ValidateAnkifySessionTokenUseCase` (slice 1), `ReissueAnkifySessionUrlUseCase` (slice 1)
- `src/lib/ankify/` — pure helpers
- `src/routes/AnkifyRouter.ts` — `/api/ankify/*` (behind `RequireAnkifyAccess`)
- `src/routes/AnkifyWebhookRouter.ts` — `/api/ankify/webhook/notion` (raw-body before `express.json`)
- `src/routes/AnkifySessionProxyRouter.ts` — in-process `/v/:token/*` handler with WebSocket upgrade (slice 1)
- `src/controllers/AnkifyController.ts` — all ankify HTTP handlers
- `web/src/pages/AnkifyPage/` — frontend (`AnkifyPage`, `AnkifySetupPage`, `AnkifyHistoryPage`, `WorkspaceBar`, `ConflictsModal`, `NotionSubscriptions`, `NotionPagePicker`, `ReviewDataExport`, `TrackerParentPicker`, `NotionDatabasePicker`, `SyncConflicts`)
- `web/src/pages/DownloadsPage/components/SendToAnkifyButton.tsx` — per-row dispatch on Downloads page

## Security posture (honest read at merge)

**Protected:**
- Network surface — Anki ports bound to `127.0.0.1` on the Hetzner box. Internet can't reach them.
- URL gate — `/v/<token>/` requires URL token + 2anki cookie + `hasAnkifyAccess` (cookie-binding).
- AnkiConnect — per-container API key; co-tenant on the docker network can't issue commands without it.
- Container — `CapDrop: ALL`, `no-new-privileges`, scoped Tmpfs for `/tmp`, `/var/run`, `/run/user/1000`.

**Not protected — known gaps:**
- The Anki collection (`/data/User 1/collection.anki2`) lives in a docker volume on the Hetzner disk in plaintext. Persistent across sessions.
- `/data/prefs21.db` holds the user's **AnkiWeb session token in plaintext**. Anyone with the volume gets the AnkiWeb account, not just the Anki collection.
- The Hetzner disk has no LUKS encryption. Stolen disk / Hetzner support / subpoena yields all of it.
- An operator with shell on the box can read the volume.
- `ReadonlyRootfs` is currently OFF — reverted because the image's AnkiConnect addon symlink resolves to a rootfs path that startup.sh writes to.

**This posture was accepted for a single-operator pilot.** It is **not** what to advertise to a paying user as "we can't read your data." Slices 3 + 7a close the at-rest gaps; see security-hardening.md for per-slice status (last verified 2026-05-08 — re-check against the prod box).

## Pending follow-ups

- **Schedule cleanup.** The `/api/ankify/exports/schedule` endpoints + `AnkifyExportScheduler` service remain in the codebase but the UI was deleted. They're dead from a user's perspective. Removable in one focused commit (also drops the migration / repo / job).
- **Slice 3 (`/data` ephemeral)** — needs companion image change. See "Image fix needed" below.
- **`ReadonlyRootfs`** — also needs the image change. Goes back on with the same companion fix.
- **Slices 4, 5, 6, 7a, 7b, 7c** — security-hardening.md tracks per-slice status.

## Image fix needed (`2anki/remote-anki-client`)

The image bakes content into `/data` at build time (`prefs21.db`, `User 1/collection.anki2`, AnkiConnect addon symlink). Mounting tmpfs over `/data` shadows it and Anki crashes with "unable to open database file." `ReadonlyRootfs` similarly fails because `startup.sh` templates the AnkiConnect API key into `/data/addons21/AnkiConnectDev/config.json`, which is a symlink to `/app/anki-connect/plugin/config.json` on the read-only rootfs.

The companion fix:

1. Move baked `/data` content to `/opt/anki-base` in the Dockerfile.
2. `startup.sh` seeds `/data` from `/opt/anki-base` if `/data` is empty (`cp -r /opt/anki-base/. /data/`), recreates the AnkiConnect symlink as a real directory copy (not a symlink — replace `ln -s -f /app/anki-connect/plugin /data/addons21/AnkiConnectDev` with `cp -r /app/anki-connect/plugin /data/addons21/AnkiConnectDev`), and chowns to the `anki` user.
3. Server-side: re-add `'/data': 'rw,nosuid,nodev,size=512m,mode=1777,uid=1000'` to `HARDENED_TMPFS` in `RacService.ts`, drop the `Mounts` block. Re-add `ReadonlyRootfs: true` to `HostConfig`.
4. Bump container memory if not already at 1.5GB to accommodate the tmpfs.
5. Rebuild image (`make docker` in remote-anki-client) before deploying the server change.

That's a few hours of image work + a server commit. **Don't merge slice 3 server changes without the image change first.**

## Local development

Two env vars are introduced by the security hardening; **both should stay unset in dev**:

| Env var | Dev | Prod |
|---|---|---|
| `ANKIFY_SESSION_URL_BASE` | unset → URL becomes `http://localhost:<port>/vnc.html?token=...` (direct loopback) | `https://2anki.net` → URL becomes `https://2anki.net/v/<token>/vnc.html` (Apache-proxied) |
| `ANKIFY_PROXY_AUTH_TOKEN` | unset → validate endpoint skips the proxy-auth header check | not currently used by in-process proxy; safe to omit |

In dev the token gets minted and hashed exactly like prod, but the browser hits noVNC directly on the host's loopback port — the cookie-binding gate is not exercised end-to-end. The prod gating is still enforced in code (and unit-tested); only the *transport* is bypassed.

To test the full prod path locally, see the **Local development** section in [security-hardening.md](./security-hardening.md).
