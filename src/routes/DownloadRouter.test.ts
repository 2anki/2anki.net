import { vi, type Mock } from 'vitest';
import express from 'express';
import cookieParser from 'cookie-parser';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import type { AddressInfo } from 'node:net';

vi.mock('../lib/storage/StorageHandler', () => {
  const getFileStream = vi.fn();
  return {
    default: class {
      getFileStream = getFileStream;
    },
    __getFileStream: getFileStream,
  };
});

vi.mock('../services/events/track', () => ({ track: vi.fn() }));

import DownloadRouter from './DownloadRouter';
import { downloadIdentityMiddleware } from './middleware/optionalAuthMiddleware';
import * as storageModule from '../lib/storage/StorageHandler';
import { anonRecoveryKey } from '../lib/upload/anonymousRecovery';

const getFileStream = (storageModule as unknown as { __getFileStream: Mock })
  .__getFileStream;

interface RouteLayer {
  route?: { path: string; stack: { handle: unknown }[] };
}

function handlersFor(routePath: string): unknown[] {
  const layers = (DownloadRouter() as unknown as { stack: RouteLayer[] }).stack;
  const layer = layers.find((entry) => entry.route?.path === routePath);
  return layer?.route?.stack.map((entry) => entry.handle) ?? [];
}

// Without the signed-in user these two routes record deck_downloaded under
// the anonymous id only, so the download tripwire never pairs a signed-in
// user's download with their conversion (#5057).
describe('DownloadRouter', () => {
  it.each(['/download/:id/:filename', '/download/:id/bulk'])(
    'resolves a signed-in user, if any, before serving %s',
    (routePath) => {
      const handlers = handlersFor(routePath);

      expect(handlers).toHaveLength(2);
      expect(handlers[0]).toBe(downloadIdentityMiddleware);
    }
  );

  it('keeps the download page open without a session lookup', () => {
    expect(handlersFor('/download/:id')).toHaveLength(1);
  });
});

describe('DownloadRouter anonymous recovery over HTTP', () => {
  const TOKEN = '3f2b8c1e-9a4d-4e7f-8b21-5c6d7e8f9a0b';
  let spoolBase: string;
  let server: http.Server;
  let url: string;

  beforeEach(async () => {
    spoolBase = fs.mkdtempSync(path.join(os.tmpdir(), 'dl-router-spool-'));
    process.env.WORKSPACE_BASE = spoolBase;
    getFileStream.mockReset();
    getFileStream.mockImplementation(async () => ({
      body: Readable.from([Buffer.from('stored-deck')]),
    }));
    const app = express();
    app.use(cookieParser());
    app.use(DownloadRouter());
    server = http.createServer(app);
    await new Promise<void>((resolve) => server.listen(0, resolve));
    url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterEach(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    fs.rmSync(spoolBase, { recursive: true, force: true });
  });

  it('serves the recovery copy kept for this browser and token', async () => {
    const res = await fetch(`${url}/api/download/recover/${TOKEN}`, {
      headers: { cookie: 'anon_id=anon-1' },
    });

    expect(res.status).toBe(200);
    expect(await res.text()).toBe('stored-deck');
    expect(getFileStream).toHaveBeenCalledWith(
      anonRecoveryKey('anon-1', TOKEN)
    );
  });

  it('answers 404 to a first-cards link a gate showed before the preview cards test ended, and reads no storage', async () => {
    const res = await fetch(`${url}/api/download/recover/${TOKEN}/preview`, {
      headers: { cookie: 'anon_id=anon-1' },
    });

    expect(res.status).toBe(404);
    expect(getFileStream).not.toHaveBeenCalled();
  });
});
