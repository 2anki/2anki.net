import http from 'node:http';

import {
  applyHttpServerTimeouts,
  HEADERS_TIMEOUT_MS,
  KEEP_ALIVE_TIMEOUT_MS,
  REQUEST_TIMEOUT_MS,
} from './httpServerTimeouts';

const APACHE_KEEP_ALIVE_TIMEOUT_MS = 5_000;

// scripts/deploy-blue-green.sh gives the upload and apkg routes their own
// backend timeout; UPLOAD_PROXY_TIMEOUT_SECONDS defaults to 900.
const APACHE_UPLOAD_PROXY_TIMEOUT_MS = 900_000;

// Node's own default, which bounds the whole request rather than the response.
const NODE_DEFAULT_REQUEST_TIMEOUT_MS = 300_000;

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

  it('waits for a slow upload body as long as the proxy waits for the response', () => {
    const server = http.createServer();

    applyHttpServerTimeouts(server);

    expect(server.requestTimeout).toBe(REQUEST_TIMEOUT_MS);
    expect(server.requestTimeout).toBeGreaterThanOrEqual(
      APACHE_UPLOAD_PROXY_TIMEOUT_MS
    );
    expect(server.requestTimeout).toBeGreaterThan(
      NODE_DEFAULT_REQUEST_TIMEOUT_MS
    );
  });
});
