import express from 'express';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import type { AddressInfo } from 'node:net';

import { isKnownAppRoute } from './knownRoutes';

const SHELL_HTML =
  '<!doctype html><html><body><div id="root"></div></body></html>';

jest.mock('../controllers/IndexController/getIndexFileContents', () => ({
  getIndexFileContents: jest.fn(() => SHELL_HTML),
}));

async function buildServer() {
  const { default: DefaultRouter } = await import('./DefaultRouter');
  const app = express();
  app.use(DefaultRouter());
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const { port } = server.address() as AddressInfo;
  return { server, url: `http://127.0.0.1:${port}` };
}

describe('DefaultRouter catch-all status', () => {
  let server: http.Server;
  let url: string;

  beforeAll(async () => {
    ({ server, url } = await buildServer());
  });

  afterAll(() => server.close());

  it.each(['/wp-content/', '/wp-includes/l10n/', '/.env.backup'])(
    'serves the shell with 404 for junk path %s',
    async (junkPath) => {
      const res = await fetch(`${url}${junkPath}`);
      const body = await res.text();
      expect(res.status).toBe(404);
      expect(body).toBe(SHELL_HTML);
    }
  );

  it.each(['/convert/not-a-real-thing', '/notion-to-ank', '/answers/nope'])(
    'returns 404 for an unknown app-shaped path %s',
    async (unknownPath) => {
      const res = await fetch(`${url}${unknownPath}`);
      expect(res.status).toBe(404);
    }
  );

  it.each(['/pricing', '/pricing/', '/convert/csv-to-anki', '/account', '/'])(
    'returns 200 for known route %s',
    async (knownPath) => {
      const res = await fetch(`${url}${knownPath}`);
      const body = await res.text();
      expect(res.status).toBe(200);
      expect(body).toBe(SHELL_HTML);
    }
  );
});

describe('sitemap parity with isKnownAppRoute', () => {
  const sitemap = fs.readFileSync(
    path.resolve(__dirname, '../../web/public/sitemap.xml'),
    'utf8'
  );
  const locPaths = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map(
    (match) => new URL(match[1]).pathname
  );

  it('extracts every sitemap loc', () => {
    expect(locPaths.length).toBeGreaterThan(30);
  });

  it.each(locPaths)('sitemap path %s passes isKnownAppRoute', (loc) => {
    expect(isKnownAppRoute(loc)).toBe(true);
  });
});

describe('CONVERT_SLUGS parity with the landing config', () => {
  const knownRoutesSrc = fs.readFileSync(
    path.resolve(__dirname, './knownRoutes.ts'),
    'utf8'
  );
  const convertBlock =
    /const CONVERT_SLUGS = new Set<string>\(\[([\s\S]*?)\]\)/.exec(
      knownRoutesSrc
    );
  const convertSlugs = [
    ...(convertBlock?.[1] ?? '').matchAll(/'([^']+)'/g),
  ].map((match) => match[1]);

  const configSrc = fs.readFileSync(
    path.resolve(
      __dirname,
      '../../web/src/pages/ConvertLandingPage/convertLandingConfig.ts'
    ),
    'utf8'
  );
  const mapBlock =
    /CONVERT_LANDING_PAGES[^=]*=\s*new Map\(\[([\s\S]*?)\]\);/.exec(configSrc);
  const configSlugs = new Set(
    [...(mapBlock?.[1] ?? '').matchAll(/\['([^']+)',/g)].map(
      (match) => match[1]
    )
  );

  it('parses a plausible number of convert slugs from both files', () => {
    expect(convertSlugs.length).toBeGreaterThan(20);
    expect(configSlugs.size).toBeGreaterThan(20);
  });

  it.each(convertSlugs)(
    'convert slug %s has a landing config entry',
    (slug) => {
      expect(configSlugs.has(slug)).toBe(true);
    }
  );
});
