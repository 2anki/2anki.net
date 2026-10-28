import { vi } from 'vitest';
import express from 'express';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import type { IFeatureFlagsRepository } from '../data_layer/FeatureFlagsRepository';
import {
  __resetFeatureFlagModuleForTests,
  __setFeatureFlagDependencies,
} from '../lib/featureFlags/getFeatureFlag';
import { NATIVE_CARD_LIMIT_FLAG } from '../lib/featureFlags/nativeCardLimit';
import { ANONYMOUS_CARD_CAP, MONTHLY_CARD_LIMIT } from '../lib/limits';

const repoReturning = (value: boolean | null) => {
  const get = vi.fn(async () => value);
  const repo: IFeatureFlagsRepository = {
    get,
    async getAll() {
      return [];
    },
    async set() {
      return null;
    },
  };
  return { repo, get };
};

async function buildServer() {
  const { default: NativeConfigRouter } = await import('./NativeConfigRouter');
  const app = express();
  app.use(NativeConfigRouter());
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const { port } = server.address() as AddressInfo;
  return { server, url: `http://127.0.0.1:${port}` };
}

describe('GET /api/native/config', () => {
  beforeEach(() => {
    __resetFeatureFlagModuleForTests();
  });

  afterAll(() => {
    __resetFeatureFlagModuleForTests();
  });

  // Signed-out app users are capped too, so the config is read with no
  // session cookie at all.
  it('answers a request with no session and reads the native_card_limit flag', async () => {
    const { repo, get } = repoReturning(true);
    __setFeatureFlagDependencies({ repository: repo });
    const { server, url } = await buildServer();
    try {
      const res = await fetch(`${url}/api/native/config`);
      expect(res.status).toBe(200);
      expect(res.headers.get('cache-control')).toBe('public, max-age=60');
      expect(await res.json()).toEqual({
        cardLimitEnabled: true,
        monthlyCardLimit: MONTHLY_CARD_LIMIT,
        previewCardCount: ANONYMOUS_CARD_CAP,
      });
      expect(get).toHaveBeenCalledWith(NATIVE_CARD_LIMIT_FLAG);
    } finally {
      server.close();
    }
  });

  it('reports the limit as off when the flag is switched off', async () => {
    __setFeatureFlagDependencies({ repository: repoReturning(false).repo });
    const { server, url } = await buildServer();
    try {
      const res = await fetch(`${url}/api/native/config`);
      expect(await res.json()).toEqual({
        cardLimitEnabled: false,
        monthlyCardLimit: MONTHLY_CARD_LIMIT,
        previewCardCount: ANONYMOUS_CARD_CAP,
      });
    } finally {
      server.close();
    }
  });

  // The app ships the cap on; a missing flag row must not switch it off.
  it('defaults the limit to on when the flag row is missing', async () => {
    __setFeatureFlagDependencies({ repository: repoReturning(null).repo });
    const { server, url } = await buildServer();
    try {
      const res = await fetch(`${url}/api/native/config`);
      expect((await res.json()).cardLimitEnabled).toBe(true);
    } finally {
      server.close();
    }
  });

  it('carries the same caps the web enforces for free accounts', async () => {
    __setFeatureFlagDependencies({ repository: repoReturning(true).repo });
    const { server, url } = await buildServer();
    try {
      const body = await (await fetch(`${url}/api/native/config`)).json();
      expect(body.monthlyCardLimit).toBe(100);
      expect(body.previewCardCount).toBe(21);
    } finally {
      server.close();
    }
  });
});
