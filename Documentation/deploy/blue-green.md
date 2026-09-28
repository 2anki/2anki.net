# Blue-green deploys

Zero-downtime cutover for 2anki.net: two pm2 apps on two ports, Apache routes to
whichever is live, the deploy script flips the route and gracefully reloads
Apache. No application code is involved. Full rationale (and why not pm2 cluster
mode) is in the original spec — recover it with
`git log -p -- Documentation/specs/blue-green-deploys.md`.

**Status: live.** `.github/workflows/deploy.2anki.net.yml` runs
`scripts/deploy-blue-green.sh` on every deploy (wired in by #2800); prod
alternates `server-blue` (:3000) and `server-green` (:3001). The
[Rollout](#rollout) and bootstrap sections below are kept as the runbook for the
manual cutovers that preceded the switch and for re-bootstrapping after an
incident.

## Pieces

| Piece | Where | Owner |
|---|---|---|
| `ecosystem.blue-green.config.js` | repo | two apps: `server-blue` (`PORT=3000`), `server-green` (`PORT=3001`) |
| `scripts/deploy-blue-green.sh` | repo | the cutover: start next color → health-check → swap Apache → drain old color |
| `/etc/apache2/conf-2anki-upstream.conf` | prod, generated | HTTP `ProxyPass`/`ProxyPassReverse`; rewritten by the script each deploy |
| `/etc/apache2/conf-2anki-ws-upstream.conf` | prod, generated | the Ankify WebSocket `RewriteRule` (`/v/*`); rewritten by the script each deploy |
| four Apache vhosts (`000-2anki*`, `000-beta*`) | prod, manual one-time edit | each `Include`s the upstream file(s) instead of static directives — see [One-time Apache setup](#one-time-apache-setup) |
| `~/.deploy_color` | prod, state | `blue` or `green` — the currently live color |

`server-green` binds 3001 even though prod's `.env` sets `PORT=3000`: pm2 injects
`PORT=3001` into the environment, and `dotenv.config()` runs with `override:
false`, so the pm2 value wins. Confirmed against prod.

## One-time Apache setup

Prod does **not** have a single proxy vhost. Four enabled vhosts all proxy the
same backend on `localhost:3000`:

| vhost | serves |
|---|---|
| `000-2anki.conf` | `2anki.net` :80 |
| `000-2anki-le-ssl.conf` | `2anki.net` :443 (the live site) |
| `000-beta.conf` | `beta.2anki.net` :80 |
| `000-beta-le-ssl.conf` | `beta.2anki.net` :443 |

Every one of them must track the live color, because a cutover deletes the old
color's port — any vhost (or rewrite) left hardcoded at `:3000` returns 502 the
moment the live color moves to green, beta included.

There are **two** kinds of upstream reference, so the script flips two include
files:

- **HTTP** — `ProxyPass`/`ProxyPassReverse`, present in all four vhosts.
- **WebSocket** — the Ankify `/v/*` `RewriteRule` (`ws://localhost:3000`),
  present only in the live `000-2anki-le-ssl.conf`.

In all four vhosts, replace the two proxy lines with the HTTP include:

```apache
# before (in every app-serving vhost)
ProxyPass / http://localhost:3000/
ProxyPassReverse / http://localhost:3000/

# after
Include /etc/apache2/conf-2anki-upstream.conf
```

In `000-2anki-le-ssl.conf` only, also replace the WebSocket rewrite block with
the WS include:

```apache
# before
RewriteEngine on
RewriteCond %{HTTP:Upgrade} =websocket [NC]
RewriteRule ^/v/(.*)$ ws://localhost:3000/v/$1 [P,L]

# after
Include /etc/apache2/conf-2anki-ws-upstream.conf
```

Seed both include files at the current live port (3000) so Apache has a valid
config before the first script run, then verify and reload:

```bash
printf 'ProxyPass /api/upload http://127.0.0.1:3000/api/upload timeout=900\nProxyPass /api/apkg http://127.0.0.1:3000/api/apkg timeout=900\nProxyPass / http://127.0.0.1:3000/\nProxyPassReverse / http://127.0.0.1:3000/\n' \
  | sudo tee /etc/apache2/conf-2anki-upstream.conf
printf 'RewriteEngine on\nRewriteCond %%{HTTP:Upgrade} =websocket [NC]\nRewriteRule ^/v/(.*)$ ws://127.0.0.1:3000/v/$1 [P,L]\n' \
  | sudo tee /etc/apache2/conf-2anki-ws-upstream.conf
sudo apachectl configtest && sudo apachectl graceful
```

`127.0.0.1` and `localhost` are equivalent here; the script writes `127.0.0.1`
to avoid IPv6-localhost resolution surprises. The deploy user already has
passwordless sudo (`NOPASSWD: ALL`), so `tee`, `mv`, and `apachectl` work
unattended.

While you're in `sites-enabled/`, move the stale
`000-2anki-le-ssl.conf.bak.*` backup out of the directory. Apache only loads
`*.conf`, so it's inert today, but a backup that ends in `.conf` would silently
load a second, conflicting vhost.

## First cutover (bootstrap)

The live app is currently a single pm2 process named `server` on 3000. The
script alternates `server-blue` / `server-green`, so the first cutover retires
`server` by hand. Run from `~/src/github.com/2anki/2anki.net` after a normal
build, with `GIT_SHA` exported to the deployed sha:

```bash
# 1. Start green on the free port (3000 is still taken by `server`).
pm2 start ecosystem.blue-green.config.js --only server-green --update-env

# 2. Confirm green reports the right sha.
curl -fsS http://127.0.0.1:3001/api/version | jq .sha   # expect $GIT_SHA

# 3. Point Apache at green and reload.
printf 'ProxyPass / http://127.0.0.1:3001/\nProxyPassReverse / http://127.0.0.1:3001/\n' \
  | sudo tee /etc/apache2/conf-2anki-upstream.conf
sudo apachectl graceful
curl -fsS https://2anki.net/api/version | jq .sha        # expect $GIT_SHA

# 4. Retire the old single-color app and record state.
pm2 stop server && pm2 delete server && pm2 save
echo green > ~/.deploy_color
```

From here, every deploy is just `GIT_SHA=<sha> scripts/deploy-blue-green.sh`,
which alternates colors automatically.

## Steady-state run

```bash
cd ~/src/github.com/2anki/2anki.net
export GIT_SHA=<the sha you just built>
scripts/deploy-blue-green.sh
```

What it does: reads `~/.deploy_color`, starts the other color, waits up to 30s
for its `/api/version` to report `GIT_SHA`, rewrites both Apache includes (HTTP
and WebSocket) to the new port, `apachectl graceful` once, verifies
`https://2anki.net/api/version` reports the new sha, waits
`OLD_COLOR_DRAIN_SECONDS` (default 15) for Apache's pre-reload worker children to
turn over, then drains and deletes the old color (SIGINT → the graceful-shutdown
handler, bounded by `kill_timeout`), and writes the new color to
`~/.deploy_color`.

The drain wait closes the only zero-downtime gap in the cutover: `apachectl
graceful` does not switch every Apache worker at once — pre-reload children keep
serving with the OLD config (still proxying to the old color's port) until they
finish their current request. Killing the old color the instant the public
health check passes left those children pointed at a dead port, so they returned
503 with `(111)Connection refused: AH00957` in the Apache error log. Pausing
before the kill lets them retire against a still-live backend.

If the new color fails its health check, the script deletes it and exits non-zero
— the current color never stopped serving. If the post-swap public check fails,
it rewrites both includes back to the old color's port, reloads, and exits.

## Dry-run

`DRY_RUN=1` prints every privileged or destructive action instead of running it,
and skips the health-check waits. Safe to run anywhere:

```bash
DRY_RUN=1 GIT_SHA=test scripts/deploy-blue-green.sh
```

For a real cutover against a non-prod box, override the paths:

```bash
SERVER_DIR=/path/to/checkout \
DEPLOY_COLOR_FILE=/tmp/deploy_color \
UPSTREAM_CONF=/tmp/upstream.conf \
WS_UPSTREAM_CONF=/tmp/ws-upstream.conf \
PUBLIC_HEALTH_URL=http://localhost/api/version \
GIT_SHA=<sha> scripts/deploy-blue-green.sh
```

## Config

| Env var | Default | Purpose |
|---|---|---|
| `GIT_SHA` | *(required)* | sha the health checks must match |
| `SERVER_DIR` | `~/src/github.com/2anki/2anki.net` | repo checkout on the box |
| `DEPLOY_COLOR_FILE` | `~/.deploy_color` | live-color state file |
| `UPSTREAM_CONF` | `/etc/apache2/conf-2anki-upstream.conf` | generated HTTP proxy include |
| `WS_UPSTREAM_CONF` | `/etc/apache2/conf-2anki-ws-upstream.conf` | generated WebSocket (`/v/*`) include |
| `ECOSYSTEM` | `$SERVER_DIR/ecosystem.blue-green.config.js` | pm2 app definitions |
| `PUBLIC_HEALTH_URL` | `https://2anki.net/api/version` | post-swap verification URL |
| `OLD_COLOR_DRAIN_SECONDS` | `15` | pause after the verified swap so Apache's pre-reload workers drain off the old color before it's killed |
| `DEPLOY_LOCK_FILE` | `~/.2anki-deploy.lock` | flock target |
| `DRY_RUN` | `0` | `1` prints actions instead of running them |

### Locking against certbot

The script `flock`s `DEPLOY_LOCK_FILE` so two deploys can't overlap. The
`mv`-from-same-directory swap is already atomic, so a certbot Apache reload can't
read a half-written include. To fully serialize a deploy against the cert-renewal
reload, point both at one root-writable lock path — set `DEPLOY_LOCK_FILE` here
and wrap the certbot deploy hook in `flock <same path> -- apachectl graceful`.
On a box without `flock` (some minimal containers) the script logs and continues
without the lock; prod has util-linux.

## Rollout

Per the spec's test plan:

1. Review this doc and the script.
2. Dry-run (`DRY_RUN=1`, or a local docker box running pm2 + Apache) with a
   parallel `curl` loop measuring the 200/502 ratio across the swap.
3. Run the bootstrap, then 2–3 manual prod cutovers during low-traffic hours,
   watching the curl loop from outside the box. Expect 100% 200s through the swap.
4. After 3 clean prod swaps, a follow-up PR replaces the single-color step in
   `deploy.2anki.net.yml` with this script.
