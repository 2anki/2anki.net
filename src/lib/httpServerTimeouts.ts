import type http from 'node:http';

// Apache proxies to this server; Node's own idle limit (5s plus a 1s buffer)
// sat right at Apache's 5s keep-alive, so reused connections could be closed
// under it. Keep these above the proxy so it is never the side that closes.
export const KEEP_ALIVE_TIMEOUT_MS = 65_000;
export const HEADERS_TIMEOUT_MS = 66_000;

export function applyHttpServerTimeouts(server: http.Server): void {
  server.keepAliveTimeout = KEEP_ALIVE_TIMEOUT_MS;
  server.headersTimeout = HEADERS_TIMEOUT_MS;
}
