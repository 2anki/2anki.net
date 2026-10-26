import { vi } from 'vitest';
import express from 'express';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import type { AddressInfo } from 'node:net';

import { isKnownAppRoute } from './knownRoutes';

const SHELL_HTML =
  '<!doctype html><html><head></head><body><div id="root"></div></body></html>';
// sendIndex stamps the consent region on the shell before sending it; the
// test requests carry no country header, so the region falls back to eea.
const SERVED_SHELL =
  '<!doctype html><html data-consent-region="eea"><head></head><body><div id="root"></div></body></html>';

vi.mock('../controllers/IndexController/getIndexFileContents', () => ({
  getIndexFileContents: vi.fn(() => SHELL_HTML),
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
      expect(body).toBe(SERVED_SHELL);
    }
  );

  it.each(['/convert/not-a-real-thing', '/notion-to-ank', '/answers/nope'])(
    'returns 404 for an unknown app-shaped path %s',
    async (unknownPath) => {
      const res = await fetch(`${url}${unknownPath}`);
      expect(res.status).toBe(404);
    }
  );

  it.each([
    '/documentation/misc/privacy-policy',
    '/documentation/misc/terms-of-service',
    '/documentation/misc/terms-of-service/',
    '/documentation/reference/privacy',
    '/documentation/reference/terms/',
  ])(
    'prerenders the legal page text into the shell for %s',
    async (legalPath) => {
      const res = await fetch(`${url}${legalPath}`);
      const body = await res.text();
      expect(res.status).toBe(200);
      expect(body).toContain('<main class="legal-prerender"');
      expect(body).toContain('</main></div>');
      expect(body).not.toBe(SERVED_SHELL);
      expect(body).toMatch(
        /<link rel="canonical" href="https:\/\/2anki\.net\/documentation\/reference\/(privacy|terms)\/">/
      );
    }
  );

  it('301s the old API docs path to the MCP connector page', async () => {
    const res = await fetch(`${url}/documentation/api/docs`, {
      redirect: 'manual',
    });
    expect(res.status).toBe(301);
    expect(res.headers.get('location')).toBe('/documentation/reference/mcp/');
  });

  it('gives the homepage its own canonical on top of the shell', async () => {
    const res = await fetch(`${url}/`);
    const body = await res.text();
    expect(res.status).toBe(200);
    expect(body).toContain(
      '<head><link rel="canonical" href="https://2anki.net/"></head>'
    );
  });

  it.each(['/pricing', '/pricing/', '/convert/csv-to-anki', '/account'])(
    'returns 200 for known route %s',
    async (knownPath) => {
      const res = await fetch(`${url}${knownPath}`);
      const body = await res.text();
      expect(res.status).toBe(200);
      expect(body).toBe(SERVED_SHELL);
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

describe('DefaultRouter contact form attachments', () => {
  let server: http.Server;
  let url: string;
  let seenNames: string[] = [];

  beforeAll(async () => {
    const { default: IndexController } =
      await import('../controllers/IndexController/IndexController');
    vi.spyOn(IndexController.prototype, 'contactUs').mockImplementation(
      async (req, res) => {
        const files = (req.files ?? []) as Express.Multer.File[];
        seenNames = files.map((file) => file.originalname);
        return res.status(200).json({ ok: true });
      }
    );
    ({ server, url } = await buildServer());
  });

  afterAll(() => server.close());

  it('keeps a non-ASCII attachment name intact', async () => {
    const form = new FormData();
    form.append('attachments', new Blob(['x']), 'PEDİATRİ.apkg');
    form.append('attachments', new Blob(['y']), '漢字.pdf');

    const res = await fetch(`${url}/api/contact-us`, {
      method: 'POST',
      body: form,
    });

    expect(res.status).toBe(200);
    expect(seenNames).toEqual(['PEDİATRİ.apkg', '漢字.pdf']);
  });
});
