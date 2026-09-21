import http from 'node:http';

import {
  applyHttpServerTimeouts,
  HEADERS_TIMEOUT_MS,
  KEEP_ALIVE_TIMEOUT_MS,
} from './httpServerTimeouts';

const APACHE_KEEP_ALIVE_TIMEOUT_MS = 5_000;

describe('applyHttpServerTimeouts', () => {
  it('keeps idle connections open longer than the proxy in front of the app', () => {
    const server = http.createServer();

    applyHttpServerTimeouts(server);

    expect(server.keepAliveTimeout).toBe(KEEP_ALIVE_TIMEOUT_MS);
    expect(server.keepAliveTimeout).toBeGreaterThan(
      APACHE_KEEP_ALIVE_TIMEOUT_MS
    );
  });

  it('gives the request headers longer than the idle window so a reused connection is not cut mid-request', () => {
    const server = http.createServer();

    applyHttpServerTimeouts(server);

    expect(server.headersTimeout).toBe(HEADERS_TIMEOUT_MS);
    expect(server.headersTimeout).toBeGreaterThan(server.keepAliveTimeout);
  });
});
