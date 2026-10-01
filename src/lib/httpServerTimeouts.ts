import type http from 'node:http';

// Apache proxies to this server; Node's own idle limit (5s plus a 1s buffer)
// sat right at Apache's 5s keep-alive, so reused connections could be closed
// under it. Keep these above the proxy so it is never the side that closes.
export const KEEP_ALIVE_TIMEOUT_MS = 65_000;
export const HEADERS_TIMEOUT_MS = 66_000;

// Same principle, for the request rather than the connection. Node's default
// requestTimeout is 300s and bounds the WHOLE request, upload body included,
// so #4581's 900s backend timeout in scripts/deploy-blue-green.sh only ever
// covered the response half: a slow uploader was destroyed at five minutes
// regardless. Prod on 2026-09-30 shows seven such kills, every one between
// 302s and 331s after the request arrived, each surfacing to Apache as
// 'AH01084 (32) Broken pipe' then a 502 and to the visitor as 'Failed to
// fetch' with no message. Match the proxy so Node is never the side that cuts.
// The cost, stated honestly: requestTimeout is per-server, so every route that
// takes a body now holds a slow one for fifteen minutes instead of five. That
// is bounded, not unbounded - headersTimeout still cuts the slow-header attack
// at 66s, and every body is size-capped (multer's per-plan fileSize on the
// upload and apkg routes, express.json's 50mb everywhere else) - but it is a
// three-fold widening of the hold window, not a no-op.
export const REQUEST_TIMEOUT_MS = 900_000;

export function applyHttpServerTimeouts(server: http.Server): void {
  server.keepAliveTimeout = KEEP_ALIVE_TIMEOUT_MS;
  server.headersTimeout = HEADERS_TIMEOUT_MS;
  server.requestTimeout = REQUEST_TIMEOUT_MS;
}
