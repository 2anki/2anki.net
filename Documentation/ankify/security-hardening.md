# Ankify security hardening — spec

Status: **partially shipped** as of 2026-05-08 via PR #2042. Written when `/ankify` was gated to a hard-coded email allowlist; that gate is gone — access is now `hasAnkifyAccess` (`src/lib/ankify/access.ts`: lifetime `patreon`, per-user `ankify_access` comp, or an active Auto-Sync subscription) and Ankify is sold as Auto Sync. Read every "allowlist" below as that gate. The per-slice table was last verified 2026-05-08; re-check slice status against the prod box before relying on it (2026-09-11 note).

## Per-slice status (read this first)

| Slice | What | Status | Blocking onboarding user #2? |
|---|---|---|---|
| 1 | Token-gated session URLs + private host ports + cookie binding | ✅ **shipped** | — |
| 2 | Container hardening (CapDrop, no-new-privs, Tmpfs, AnkiConnect API key) | ⚠ **partially shipped** — `ReadonlyRootfs` reverted because `startup.sh` templates the API key into a config file that resolves to a path on the rootfs. Re-enable when the image moves the addon out of the rootfs. | ⚠ partial gap |
| 3 | Ephemeral `/data` (tmpfs replaces the named volume) | ⏸ **deferred — needs companion image change.** First attempt broke Anki because mounting tmpfs over `/data` shadowed the image-baked profile + AnkiConnect addon. Reverted. See README "Image fix needed" for the canonical fix. | **yes** — `prefs21.db` holds the AnkiWeb session token in plaintext today. |
| 4 | Operator audit log + weekly publish | ⏸ planned, ~0.5d | recommended before un-gating |
| 5 | `/privacy/ankify` page | ⏸ planned, ~1h (copy already drafted in this doc) | recommended before un-gating |
| 6 | gVisor runtime | ⏸ planned, ~2d, defense in depth | no |
| 7a | Host-level LUKS on Hetzner + dropbear-initramfs | ⏸ planned, ~4h + downtime window | **yes** — disk is unencrypted today |
| 7b | KMS-keyed per-tenant volumes | ⏸ planned, ~1w; on-demand once paying users exist | no |
| 7c | User-passphrase "private vault" | ⏸ planned, ~2–3w; only when a user asks | no |

**Gating set before un-gating the allowlist:** finish 3 + 4 + 5 + 7a (the rest are post-gate). Roughly one focused day of code + one downtime window.

## Spec body (unchanged)

This spec turns the conversation-level assessment into a buildable plan. It's grouped by the area of risk it closes, in the order I'd ship.

## Revision log

- **2026-05-08 v2** — incorporated a second review pass against the running container's actual config (Dockerfile / Makefile / `config/anki-connect.json`). Three real adds: cookie-binding to the session URL (a leaked URL alone shouldn't grant access), AnkiConnect API key templated per-container (defense in depth even with loopback binding), and dropping raw VNC (5900) host exposure entirely (Qt VNC has no password mechanism, noVNC-over-TLS is the only sanctioned path). Small adds: strip `find /` debug from `startup.sh`, actively verify non-root before claiming it, flag that `prefs21.db` holds the user's AnkiWeb session token, host-level LUKS as a cheap pre-stage. Sequencing unchanged; surface area within slice 1 and slice 2 grew slightly.

## Threat model in one paragraph

The service runs each user's Anki desktop inside a Docker container on a host the operator (Alexander) administers. A web client talks to a server that talks to AnkiConnect inside that container; the user also opens noVNC in their browser to drive Anki by hand. Today, host ports are bound publicly, no TLS, no auth on the container endpoints, and named volumes persist user data on disk between sessions. Threats we want to defend against, in order of impact: (1) **a stranger discovering and hijacking another user's session** by port-scanning the host, (2) **a compromised operator** (host root) reading user data when no session is running, (3) **a compromised operator** snooping on an active session, (4) **a malicious user inside their own container** escaping to the host or another container.

We can fully close (1). We can fully close (2) with reasonable engineering. We bound (3) but cannot fully eliminate it without confidential computing — be honest about it. We materially raise the cost of (4).

## What we are NOT solving in this spec

- End-to-end encryption against a malicious operator during an active session. The operator runs the host; full prevention requires confidential-computing hardware (SEV-SNP / TDX / Nitro Enclaves). Out of scope.
- Auditing the AnkiConnect plugin itself for vulnerabilities. We treat it as a third-party dependency and confine it.
- Server-side persistence of Anki collection data. We're moving to a model where AnkiWeb is the source of truth and we hold a session-scoped working copy only.

## Deployment context — bare-metal Hetzner

The prod box is a bare-metal Hetzner dedicated server. A few things this changes versus a cloud-provider deployment:

- **No managed disk encryption.** Hetzner ships unencrypted disks by default. Tier 7a (host-level LUKS) is a real operation, not a config toggle. For a fresh box: install with LUKS on the data partition during setup. For an existing box: schedule downtime, back up, repartition, restore. **Plan downtime.**
- **No managed firewall in front of the box.** The public IP hits the host directly. `ufw` (or raw iptables / nftables) IS the perimeter. Default deny inbound, then explicitly allow 22, 80, 443. Drop everything else, including the 20000–23000 port range that today is publicly bindable. After slice 1's loopback binding, the firewall is belt-and-suspenders, but ship it anyway.
- **No managed KMS.** Tier 7b's clean answer (AWS KMS / GCP KMS / Vault Cluster) requires either self-hosting Vault on a second small Hetzner box, or accepting a remote-managed KMS (HashiCorp Cloud Platform free tier, Doppler, etc.) with the latency / vendor-trust cost that implies. Pragmatic interim: a key file on a *separate* small Hetzner Cloud VPS that the prod box authenticates to over WireGuard, with key fetched on boot and held in memory only. Less turnkey than a real KMS but possible.
- **Boot-time disk decryption needs remote unlock.** No KVM-over-IP convenience like a cloud console. `dropbear-initramfs` is the right answer: a tiny SSH server in initramfs accepts the LUKS passphrase over the network at boot, unlocks the data partition, exits, and the normal boot continues. Set up once, paste the passphrase whenever the box reboots.
- **Single-host blast radius.** Everything runs on one box: server, Caddy, Anki containers, Postgres, Notion adapter. A successful compromise of the box is total. This shifts the "should the proxy be on a separate box?" question — on bare-metal Hetzner, "separate box" means ordering another machine, not a 5-second cloud spin-up. **Same-host for now is fine; revisit after the second non-Alex user.**
- **DDoS.** Hetzner has volumetric DDoS protection by default (decent). Application-layer DDoS (e.g., L7 floods at `/v/<token>/`) needs Caddy's rate-limiting or a separate WAF. Out of scope for the gating set; flag for later.
- **Backups.** Tier 7's encryption story is moot if backups land somewhere unencrypted. Whatever backup target you use (Hetzner Storage Box, Backblaze, restic to S3-compatible), encrypt the backup separately with a key that lives on the prod box only. `restic` does this natively. **Confirm before promising "we don't keep readable copies anywhere."**

---

## Slice 1 — Token-gated reverse proxy + private container ports + cookie binding

This is the single most important change. It closes the URL-guessability and VNC-exposure risks together, and makes every later slice easier because it abstracts container port allocation behind a name.

### Architecture target

```
Browser  ── 2anki session cookie (httpOnly, Secure, SameSite=Lax) ─┐
  │  https://2anki.net/v/<token>/  (TLS, WebSocket upgrade)    │
  ▼                                                                 │
Caddy (or Traefik) on the host's public IP                         │
  │  forward_auth → POST /api/ankify/sessions/validate              │
  │      headers: { X-Session-Token, Cookie }                       │
  │  on 200, reads X-Backend-Port and proxies to:                   │
  ▼                                                                 │
127.0.0.1:<novnc_port>  (only the noVNC port; raw VNC 5900 is NOT  │
                         host-bound at all)                         │
```

Two factors gate access: the URL-borne token (proves you have the right link) and the 2anki session cookie (proves you're the authenticated user the link was issued for). Either alone is insufficient. A leaked URL in a screenshot is useless to anyone not already signed in to your 2anki account.

Same proxy serves the existing `/api/ankify/*` and `/api/notion/webhook/*` paths under TLS, so the public surface is one hostname, one cert.

### Server changes

1. **`src/services/ankify/RacService.ts` — change port binding, drop raw VNC**

   In `createAndStartContainer()`:
   - Bind noVNC and AnkiConnect on `127.0.0.1` only.
   - **Stop publishing port 5900 to the host entirely.** Qt VNC has no password mechanism, so loopback-binding is still wrong — even server-internal access via 5900 is unnecessary because we drive Anki via AnkiConnect, not via VNC. Remove it from `ExposedPorts` and `PortBindings`.

   ```ts
   ExposedPorts: {
     [`${CONTAINER_INTERNAL_ANKI_PORT}/tcp`]: {},
     [`${CONTAINER_INTERNAL_NOVNC_PORT}/tcp`]: {},
     // 5900 is intentionally not host-published
   },
   PortBindings: {
     [`${CONTAINER_INTERNAL_ANKI_PORT}/tcp`]: [
       { HostIp: '127.0.0.1', HostPort: ankiPort.toString() },
     ],
     [`${CONTAINER_INTERNAL_NOVNC_PORT}/tcp`]: [
       { HostIp: '127.0.0.1', HostPort: novncPort.toString() },
     ],
   }
   ```

   Drop the `vnc_port` column from `ankify_clients` (or keep it as a vestigial column populated with `0`; leaving it makes the migration smaller). Drop the port allocation logic for the VNC range. AnkiConnect at `127.0.0.1:<anki_port>` is still reachable from the server process (which already calls it as `localhost`). noVNC is no longer reachable from the public internet.

2. **New table: `ankify_session_tokens`**

   ```sql
   CREATE TABLE ankify_session_tokens (
     id              SERIAL PRIMARY KEY,
     ankify_client_id INTEGER NOT NULL REFERENCES ankify_clients(id) ON DELETE CASCADE,
     owner           INTEGER NOT NULL,
     token_hash      VARCHAR(64) NOT NULL UNIQUE,   -- sha256 hex of the plaintext token
     expires_at      TIMESTAMP NOT NULL,
     last_used_at    TIMESTAMP,
     revoked_at      TIMESTAMP,
     created_at      TIMESTAMP DEFAULT now()
   );
   CREATE UNIQUE INDEX ankify_session_tokens_one_active_per_client
     ON ankify_session_tokens(ankify_client_id) WHERE revoked_at IS NULL;
   CREATE INDEX ankify_session_tokens_lookup ON ankify_session_tokens(token_hash);
   ```

   We never store the plaintext token. The plaintext lives only on the client (in the URL). Lookups hash the incoming token first.

3. **New repo: `AnkifySessionTokensRepository`**

   ```
   mint(input: { ankify_client_id, owner, ttl_hours }) → { plaintext, row }
   findByHash(token_hash) → row | null
   touchLastUsed(id) → void
   revoke(id) → void
   revokeByClientId(ankify_client_id) → void   // called on stop / respin
   ```

   `mint` is the only place plaintext exists server-side: generate `crypto.randomBytes(32)`, base64url-encode, hash with SHA-256, insert hash row, return `{ plaintext, row }`. The plaintext is returned **once** to the controller and never persisted.

4. **Mint on provision and respin**

   In `RacService.provision()` and `RacService.respin()`, after `repo.create(...)`, call `tokens.mint({ ankify_client_id: client.id, owner, ttl_hours: 8 })`. Add the plaintext to the `ProvisionResult`:

   ```ts
   interface ProvisionResult {
     client: AnkifyClient;
     created: boolean;
     session_url: string;   // https://2anki.net/v/<plaintext>/
   }
   ```

   On `stop`, call `tokens.revokeByClientId(client.id)` so the URL stops working immediately.

5. **New endpoint: `POST /api/ankify/sessions/validate`** (called by the proxy from localhost only)

   - Accept `X-Session-Token` header (the URL-borne token) and the original request's `Cookie` header (for the 2anki session cookie).
   - Hash the token, look up `ankify_session_tokens` by hash.
   - Reject (401) if: token not found / revoked / expired / linked client not active.
   - **Resolve the user from the cookie** using the existing auth middleware (`getUserFrom(cookies.token)` per `src/services/AuthenticationService.ts`). Reject (401) if no user OR if `user.id !== token.owner` — this is the cookie-binding check.
   - Reject (403) if `user.email` is not on `ANKIFY_ALLOWLIST_EMAILS` (matches existing route guard).
   - Else: `touchLastUsed`, respond 200 with header `X-Backend-Port: <novnc_port>` and an empty body.

   Lock this endpoint to listen on `127.0.0.1` only at the express level. Belt-and-suspenders: the proxy sends a static shared secret in `X-Proxy-Auth` that the validate endpoint checks. Set on both via the same env var.

6. **Reaper integration**

   When the idle reaper marks a client deleted (existing `RacService.reapIdle()`), revoke its tokens too. This is a single line in the reaper loop after `repo.deleteById(client.id)`: ON DELETE CASCADE on the FK already handles it. Confirm the cascade clause in the migration.

### Client changes

1. **`Backend.provisionAnkifyClient()` return type**: gain `session_url: string`. Don't expose `novnc_port` to the client at all going forward.

2. **`AnkifyPage.ankiUrlFor(client)`** is removed. Read `session_url` from the provision/list response. The list endpoint also returns `session_url` — server constructs it on the fly using the active token row, or returns null if no token is live (UI shows "Reissue session link" button).

3. **Connection details disclosure** in the active card no longer shows the noVNC port. The whole point is that the port is an implementation detail.

### Proxy config (Caddy)

```caddyfile
2anki.net {
  # API + webhook + web app — existing
  reverse_proxy /api/* localhost:2020
  reverse_proxy /api/ankify/webhook/* localhost:2020
  reverse_proxy localhost:3000  # Vite/web

  # Session proxy
  @session path_regexp session ^/v/([A-Za-z0-9_-]{43})/?(.*)$
  handle @session {
    forward_auth localhost:2020 {
      uri /api/ankify/sessions/validate
      copy_headers X-Backend-Port
      header_up X-Session-Token "{re.session.1}"
    }
    rewrite * /{re.session.2}
    reverse_proxy {
      to localhost:{header.X-Backend-Port}
      transport http {
        # Allow long-lived noVNC websocket
        read_timeout 24h
      }
    }
  }
}
```

Traefik or nginx versions are equivalent; the structure is "extract token from path → forward_auth resolves to backend port → reverse-proxy with WebSocket upgrade."

### Why Caddy over Traefik for this setup

Single host, single cert, three or four logical routes. Caddy: one binary, one Caddyfile, automatic Let's Encrypt, native `forward_auth` and WebSocket upgrade. Traefik: more flexible (label-driven discovery, dynamic config), heavier config burden, real value only if the service mesh grows. Pick Traefik if you're going to docker-compose or a swarm; otherwise Caddy is the clean answer.

### Local development

You should not need to run Caddy locally. As shipped, the simpler dev path: when `ANKIFY_SESSION_URL_BASE` is unset, the server returns a direct loopback URL (`http://localhost:<novnc_port>/vnc.html?token=<plaintext>`) instead of the proxy form (`https://2anki.net/v/<token>/vnc.html`). The dev box IS the host running the container, so the loopback noVNC port is reachable directly — Caddy is only there in prod to terminate TLS and gate via cookie-binding.

**Required env in dev: none.** Both env vars are unset and behaviours fall back to dev-friendly defaults:

| Env var | Set in prod | Set in dev | When unset |
|---|---|---|---|
| `ANKIFY_SESSION_URL_BASE` | `https://2anki.net` | leave unset | URL becomes `http://localhost:<port>/vnc.html?token=...` and goes direct to the loopback-bound noVNC. |
| `ANKIFY_PROXY_AUTH_TOKEN` | random 32+ bytes, also configured in the Caddyfile | leave unset | The `/api/ankify/sessions/validate` endpoint skips the proxy-auth header check. Token + cookie + allowlist gates still run. |

**What this means for what's actually exercised in dev:**

- The token gets minted, hashed, and stored in `ankify_session_tokens` exactly like prod — that part is identical.
- The browser hits noVNC directly on `localhost:<port>`, so Caddy `forward_auth` is **not on the path**, and the cookie-binding check never runs.
- `POST /api/ankify/sessions/validate` is reachable but unused in the normal dev flow.

This is fine as a daily-driver workflow because the prod gating is still enforced in code (and unit-tested) — it's the *transport* that's bypassed in dev, not the logic.

**Testing the full prod gating locally** (only when debugging the gate itself, e.g. a cookie `SameSite` quirk that only repros over HTTPS):

```bash
export ANKIFY_SESSION_URL_BASE=https://localhost
export ANKIFY_PROXY_AUTH_TOKEN=$(openssl rand -base64 32)
caddy run --config dev/Caddyfile.local  # not committed; copy from prod and swap the upstream
```

The Caddyfile must send the same `ANKIFY_PROXY_AUTH_TOKEN` value as `X-Proxy-Auth` on every `forward_auth` request to `/api/ankify/sessions/validate`. Optional, not required for normal dev.

### Tests

- `RacService.provision` mints a token; the result includes `session_url`. (RacService.test.ts already mocks the repo; add a `tokens` mock.)
- `tokens.mint` returns plaintext with 43-char base64url, stores hash only.
- `validate` endpoint: 401 for unknown / revoked / expired; 200 with header for valid; 401 if client not active.
- Stop and reap revoke tokens (DB row gets `revoked_at`).

### Complexity: **medium.** ~3 days for the full slice including tests and deployment of Caddy.

---

## Slice 2 — Container hardening baseline

These are config-only changes inside `RacService.createAndStartContainer()` plus one daemon-level config edit. Each one is independently valuable; ship them all.

### Docker container args

```ts
HostConfig: {
  AutoRemove: true,
  Memory: 768 * 1024 * 1024,
  CpuQuota: 50_000,
  CpuPeriod: 100_000,
  // NEW
  CapDrop: ['ALL'],
  SecurityOpt: ['no-new-privileges:true'],
  ReadonlyRootfs: true,
  Tmpfs: {
    '/tmp': 'rw,nosuid,nodev,size=128m',
    '/var/run': 'rw,nosuid,nodev,size=8m',
    '/run/user/1000': 'rw,nosuid,nodev,size=32m',  // Anki Qt user runtime
  },
  // existing volume mount stays
  Mounts: [...],
  PortBindings: {
    // already loopback-only after slice 1
  },
  NetworkMode: `ankify-${owner}-${Date.now()}`,
}
```

The dynamic per-session network name is created with `docker.createNetwork({ Name: ..., Internal: false })` before container start, and removed after the container's container.remove() in stop / reap. Containers on different networks cannot reach each other; AnkiWeb is still reachable because `Internal: false`.

### Daemon config — `/etc/docker/daemon.json`

```json
{
  "userns-remap": "default",
  "no-new-privileges": true,
  "icc": false,
  "default-runtime": "runc"
}
```

`userns-remap` requires:

- One-time chown of existing volumes after the daemon flag is enabled: `chown -R 100000:100000 /var/lib/docker/volumes/ankify-*`. Ship this in a one-shot deploy script, not a migration.
- The `remote-anki-client` image's `USER anki` (UID 1000) becomes UID 101000 on the host — outside any meaningful host user space.

`icc: false` disables inter-container communication on the default bridge (a fallback if the per-session network mode is bypassed somehow).

### AnkiConnect API key

Even with loopback-only host binding, anything on the docker network can reach AnkiConnect on the container's `:8765` and POST commands without auth. Today `config/anki-connect.json` ships with no `apiKey`, and `webBindAddress: 0.0.0.0`. Fix:

1. **Server side** — when provisioning, generate a per-container API key (`crypto.randomBytes(32).toString('base64url')`), persist on `ankify_clients.anki_connect_api_key` (new column, encrypted at rest if the host disk gets the LUKS treatment in slice 7), and pass to the container via env var `ANKICONNECT_API_KEY`.

2. **Image side** — `2anki/remote-anki-client`'s `startup.sh` reads `ANKICONNECT_API_KEY` and templates it into `config/anki-connect.json` (`apiKey: "${ANKICONNECT_API_KEY}"`) before launching Anki. Same change makes it possible to also set `webBindAddress: 127.0.0.1` so AnkiConnect binds only to the container's loopback.

3. **AnkiConnectClient** — every outgoing request from the server now includes the key as a `key` field in the action params (per AnkiConnect's wire format). One-line change in `runAction` / `invoke`.

After this, even an attacker who reaches `:8765` on a co-located container's network — or, in a multi-tenant future, on the host's docker bridge — cannot issue commands without the key. Defense in depth on top of the loopback binding.

### Image hygiene

Two small edits to `2anki/remote-anki-client`:

1. **Drop the leftover `find /` debug call from `startup.sh`.** It runs once at container start and produces noise in logs. Has no functional purpose; reads as either a forgotten debug statement or a backdoor in a security review. Remove.
2. **Verify non-root before claiming it.** CLAUDE.md says `USER anki`. Confirm by `docker exec <container> id` returning a non-zero UID before promising "containers run as a non-root user" anywhere user-facing. Land this as a one-line assertion in the deploy runbook so future image changes don't regress it silently.
3. **Read-only-rootfs adjustments.** Anki currently writes Qt cache to `/run/user/1000` — covered by the `Tmpfs` `/run/user/1000` entry above. Confirm with `strace` once before the read-only flag goes prod.
4. **Volume permissions for userns-remap.** Add `chmod g+rwx /data` so the user-namespace-remapped UID can write. (Stays even after slice 3 — `/data` becomes tmpfs but the same chmod still applies inside the container.)

### Tests

- New unit test in `RacService.test.ts`: assert `createContainer` is called with `CapDrop: ['ALL']`, `ReadonlyRootfs: true`, `SecurityOpt: ['no-new-privileges:true']`.
- New integration smoke (manual, in deploy runbook): start a container, exec into it, try `mount`, `ip link add`, write to `/etc` — all should fail.

### Complexity: **low** for the Docker arg changes (~half a day including tests). **Medium** for the daemon-level userns-remap because of the volume-chown rollover.

---

## Slice 3 — Ephemeral by default

Persistent named volumes give the operator readable disk artifacts even when no session is running. Switching to tmpfs eliminates that, and AnkiWeb already serves as the source of truth for the user's collection.

**Sharper reason than I had originally.** The volume contains `prefs21.db`, which holds the user's **AnkiWeb session token** in plaintext. With persistent volumes, that token sits on the operator's disk between sessions — meaning the operator can mount the volume offline and effectively own the user's AnkiWeb account, not just the Anki collection. Ephemeral mode means the token only exists in container memory while the session is running, and is gone when the tmpfs is wiped on container destroy. This is the actual reason the persistent-volume default is not safe to ship.

### Server changes

1. **`RacService.createAndStartContainer()`**: replace the named volume mount

   ```ts
   // OLD
   Mounts: [{ Type: 'volume', Source: ankifyVolumeNameForOwner(owner), Target: '/data' }]

   // NEW (default)
   Tmpfs: {
     ...existing,
     '/data': 'rw,nosuid,nodev,size=512m',
   }
   ```

2. **Drop `ankifyVolumeNameForOwner` and the volume-creation calls in provision/respin/stop.** Volumes simply aren't part of the lifecycle anymore.

3. **Bootstrap script inside the container** that runs after Anki starts, before the user signs in:

   - Configure Anki's `~/.local/share/Anki2/profile.json` to point at the user's empty `/data/collection` so Anki's first sync fetches everything from AnkiWeb.
   - This is a small change to the existing `startup.sh` in `2anki/remote-anki-client`.

4. **Onboarding copy update on `/ankify`**: step 3 ("Run your first sync") becomes the moment the user's collection actually lands in the container. Lean into this in the spec for slice 5 (privacy claims). The copy is already step-aware; it just needs a sentence noting "we don't store your collection between sessions — your AnkiWeb account does."

### Migration story for existing users

There is one user (Alexander). Drop the existing `ankify-rac-owner-N-data` volumes manually as part of the deploy: `docker volume rm $(docker volume ls -q | grep ankify-rac)` after stopping the active session. No migration code needed.

### Optional v3 — encryption tiers (three of them)

Three increasingly-strong options, sequenced cheapest-first. Pick the highest one a customer's threat model justifies.

**Tier 3a — Host-level disk encryption (LUKS or cloud provider volume encryption).**
- The host disk that holds tmpfs-spillover, ephemeral container layers, and any docker volumes is itself encrypted at rest.
- Protects against a stolen disk or a subpoenaed cold backup. **Does not** protect against the running operator — host root has the key.
- Implementation: enable on the prod box. Cloud providers do this by default; on a self-managed Linux box, set up `cryptsetup luksFormat` on the data partition and unlock at boot via a TPM-stored key or a manual passphrase.
- **Complexity: low.** ~half a day on a fresh box; bigger on an existing box (data move).
- **Ship this regardless of which higher tier you choose** — it's a cheap floor under everything.

**Tier 3b — Per-tenant volume encryption with operator-managed keys (KMS).**
- Each tenant volume is encrypted with a key stored in a KMS (HashiCorp Vault, AWS KMS, GCP KMS).
- Reduces blast radius — disk theft yields ciphertext only.
- Adds **crypto-shredding on deletion**: destroy the key, the bytes become unrecoverable garbage even if a backup leaked.
- Logs every key access — auditable.
- **Still does not** answer "even from you" — on-call ops with KMS access can read.
- **Complexity: medium.** ~1 week to wire a KMS client + key-per-tenant lifecycle + destroy-on-delete. Recommended for the default plan once paying users exist.

**Tier 3c — User-supplied passphrase, key never on host disk.**
- User sets a passphrase at session bootstrap.
- Server derives a key with Argon2id (parameters: m=64MB, t=3, p=4), uses it to open a LUKS-formatted sparse file mounted into the container as a block device.
- Key lives in process memory only — never written to disk, never logged. On container stop / idle, key is purged (`Buffer.fill(0)`) before garbage collection.
- This is the **only** configuration that earns the "I cannot read your data" sentence.

**Honest disclosures that go with Tier 3c:**

- *While a session is live, the key is in the container's memory.* A malicious operator who compromises the host **during** an active session can extract it. After the session ends and tmpfs is wiped, the key is gone for good.
- *AnkiWeb sync still leaves user data on Anki's servers.* The Tier 3c guarantee is about **our hosting**, not Anki's. If the user wants end-to-end privacy from Anki itself too, they should not enable AnkiWeb sync.
- *Lost passphrase = lost data, by design.* No recovery. Documented in the UI before passphrase entry.
- **UX cost.** Passphrase entry per session via a small splash page before noVNC loads. Breaks the zero-friction flow. Reasonable middle path: keep Tier 3a + 3b as the default; offer Tier 3c as an opt-in "private vault" tier (paid, or for users who specifically ask).

**Complexity: high.** ~2–3 weeks of careful work + a separate passphrase UX path. Spec but don't build until a user asks.

### Tests

- `RacService.provision` with the new flow: assert `Mounts` doesn't include a volume, `Tmpfs` has `/data`.
- Integration smoke: start a session, sign into AnkiWeb, write a card; stop; provision a fresh session, sign into AnkiWeb, confirm the card is there (came from AnkiWeb, not from a persisted volume).

### Complexity: **low** (~1 day) for ephemeral default. Encrypted mode is **high** (~2–3 weeks).

---

## Slice 4 — Operator audit log

Even if the operator can technically `docker exec` into a running container, **logged access** is what makes the privacy claim defensible. Two pieces:

1. **Wrap the host shell** so `docker exec`, `docker inspect`, and `docker volume` against `ankify-*` containers/volumes append to `/var/log/ankify-operator-access.log` with the timestamp, command, and tty user. Implement as a tiny shell wrapper sourced from `~/.bashrc`. Not an actual access control — just a transparent log.

2. **A weekly job** (cron or GitHub Action against the prod box) that publishes the last 7 days of `/var/log/ankify-operator-access.log` to a public URL like `https://2anki.net/audit/ankify-week-<n>.log`. Or, more practically, posts it to the same Patreon community where users see roadmap updates.

The point isn't airtight — a malicious operator can disable the wrapper. The point is making access expensive to do silently and easy to audit publicly. That's the basis on which "operator access requires explicit consent or legal request, and is logged" is an honest claim instead of a marketing one.

### Complexity: **low** (~half a day for the wrapper + a one-line cron entry).

---

## Slice 5 — Privacy page on 2anki.net

Once slices 1–4 are live, ship a `/privacy/ankify` page that says, exactly:

> ### What we promise about Ankify
>
> **No data at rest between sessions.** When your session ends or times out, the Docker container that ran your Anki is destroyed and its in-memory `/data` is wiped. We retain no copy of your Anki collection on our servers between sessions.
>
> **AnkiWeb is your source of truth.** Your collection lives with AnkiWeb (Anki's official cloud service), not us. We sign into your AnkiWeb account inside the running session at your direction; your AnkiWeb password is typed directly into the embedded Anki window and stays there.
>
> **Each session is isolated.** Containers run on a per-session network with no path to other users' containers. A compromise inside one session cannot reach another.
>
> **Session URLs are unguessable and short-lived.** Each session URL contains a 256-bit random token that we store only as a hash. Tokens expire after 8 hours of inactivity and rotate when the container is restarted.
>
> ### What's still true
>
> While your session is **actively running**, an operator with shell access to our host can technically observe what's happening inside your container — the same is true of any cloud service. We never do this without your explicit consent or a legal requirement, and we publish a weekly log of every operator access at `/audit/ankify-week-N`. Once your session ends, there's nothing left to access.
>
> ### What we don't promise
>
> End-to-end encryption against a malicious operator during an active session. If you need that, run Anki locally — that's the right tool for the threat model.

The exact text matters: every claim is something we can defend if challenged.

### Complexity: **low** (~1 hour for the page; the engineering it commits us to is the rest of this spec).

---

## Sequencing and gating

| # | Slice | Days | Gate before un-gating allowlist? |
|---|---|---|---|
| 1 | Token-gated reverse proxy + private container ports + cookie binding (drops 5900 entirely) | 3 | **yes** |
| 2 | Container hardening baseline (caps, no-new-privs, read-only, per-session network, userns-remap) **+ AnkiConnect API key** | 2 | **yes** |
| 3 | Ephemeral default (closes the `prefs21.db` AnkiWeb-token-on-disk gap) | 1 | **yes** |
| 4 | Operator audit log + public weekly publish | 0.5 | yes (cheap, do alongside 1–3) |
| 5 | Privacy page | 0.1 | yes (after 1–4 land) |
| 6 | gVisor runtime | 2 | no (defense in depth, ship after onboarding) |
| 7a | Host-level disk encryption (LUKS) | 0.5 | yes (cheap floor, ship with 1–4) |
| 7b | KMS-keyed per-tenant volumes (default plan) | 5 | no (after first paying user) |
| 7c | User-passphrase "private vault" mode (opt-in) | 15+ | no (only when a user specifically asks) |

**Total before un-gating: roughly one focused week** (slices 1–5 + 7a).

## Open questions for Alexander

1. **Where does the proxy run?** Same host as the server (simplest), or a separate small box for blast-radius isolation? My vote: same host for now, separate later if the user count grows past ~50.
2. **Token TTL.** 8 hours is long enough that nobody re-clicks during a study session and short enough that lost URLs aren't dangerous overnight. Comfortable with that, or shorter?
3. **Operator audit log destination.** Public weekly file, Patreon post, both? Public is more defensible; Patreon is more visible to the audience that cares.
4. **Privacy page tone.** I leaned dry-and-honest. Some users prefer a single one-line "we never see your data" — but that would be a lie. Defer to your taste.
