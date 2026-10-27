import { vi } from 'vitest';

import { DEPLOY_SMOKE_PAGES, runDeploySmoke } from './runDeploySmoke';
import { SAMPLE_DECK_CARD_COUNT } from '../upload/sampleDeck';

const BASE = 'http://127.0.0.1:3001';
const BUNDLE = 'https://cdn.example/assets/index-abc.js';
const HOME_TITLE = 'Convert Notion to Anki Flashcards — 2anki.net';
const APKG = Buffer.concat([
  Buffer.from([0x50, 0x4b, 0x03, 0x04]),
  Buffer.alloc(32),
]);

function html(title: string, canonical: string | null): string {
  const canonicalTag =
    canonical == null ? '' : `<link rel="canonical" href="${canonical}">`;
  return `<html><head><title>${title}</title><script type="module" crossorigin src="${BUNDLE}"></script>${canonicalTag}</head><body><div id="root"></div></body></html>`;
}

const homeShell = html(HOME_TITLE, null);

interface FakeSite {
  pages: Map<string, string>;
  bundleStatus: number;
  sample: { status: number; cardCount: string; body: Buffer };
}

function healthySite(): FakeSite {
  const pages = new Map<string, string>();
  for (const { path, canonical } of DEPLOY_SMOKE_PAGES) {
    const title = path === '/' ? HOME_TITLE : `Page ${path}`;
    pages.set(path, html(title, canonical));
  }
  return {
    pages,
    bundleStatus: 200,
    sample: {
      status: 200,
      cardCount: String(SAMPLE_DECK_CARD_COUNT),
      body: APKG,
    },
  };
}

function fakeFetch(site: FakeSite) {
  return vi.fn(async (url: string, init?: RequestInit) => {
    if (url === BUNDLE) {
      return new Response('', { status: site.bundleStatus });
    }
    const path = url.slice(BASE.length);
    if (path === '/api/upload/sample' && init?.method === 'POST') {
      return new Response(new Uint8Array(site.sample.body), {
        status: site.sample.status,
        headers: { 'X-Card-Count': site.sample.cardCount },
      });
    }
    const body = site.pages.get(path);
    return body == null
      ? new Response('not found', { status: 404 })
      : new Response(body, { status: 200 });
  });
}

describe('runDeploySmoke', () => {
  it('passes a healthy build', async () => {
    const result = await runDeploySmoke(BASE, fakeFetch(healthySite()));

    expect(result.failures).toEqual([]);
    expect(result.passed).toEqual([
      ...DEPLOY_SMOKE_PAGES.map(({ path }) => path),
      'app bundle',
      'sample conversion',
    ]);
  });

  it('fails when a landing page serves the home shell, the #4730 regression', async () => {
    const site = healthySite();
    site.pages.set('/pdf-to-anki/', homeShell);

    const result = await runDeploySmoke(BASE, fakeFetch(site));

    expect(result.failures).toEqual([
      '/pdf-to-anki/: no canonical link, expected https://2anki.net/pdf-to-anki/',
      '/pdf-to-anki/: serves the home page title, so the home shell was sent instead of its prerendered page',
    ]);
  });

  it('fails when the app bundle the page loads is missing', async () => {
    const site = healthySite();
    site.bundleStatus = 403;

    const result = await runDeploySmoke(BASE, fakeFetch(site));

    expect(result.failures).toEqual([
      `app bundle: ${BUNDLE} returned HTTP 403, expected 200`,
    ]);
  });

  it('fails when the sample conversion drops cards', async () => {
    const site = healthySite();
    site.sample.cardCount = '0';

    const result = await runDeploySmoke(BASE, fakeFetch(site));

    expect(result.failures).toEqual([
      `sample conversion: 0 cards, expected ${SAMPLE_DECK_CARD_COUNT}`,
    ]);
  });

  it('marks the sample conversion as deploy smoke traffic from an allowed origin', async () => {
    const fetchImpl = fakeFetch(healthySite());

    await runDeploySmoke(BASE, fetchImpl);

    const sampleCall = fetchImpl.mock.calls.find(([url]) =>
      url.endsWith('/api/upload/sample')
    );
    expect(sampleCall?.[1]).toMatchObject({
      method: 'POST',
      headers: {
        Origin: 'https://2anki.net',
        'x-2anki-deploy-smoke': '1',
      },
    });
  });

  it('reports a request that throws instead of crashing', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new TypeError('fetch failed');
    });

    const result = await runDeploySmoke(BASE, fetchImpl);

    expect(result.failures).toContain('/: request failed (fetch failed)');
    expect(result.passed).toEqual([]);
  });

  it('names the underlying network error when fetch wraps one', async () => {
    const fetchImpl = vi.fn(async () => {
      const error = new TypeError('fetch failed');
      Object.assign(error, { cause: new Error('connect ECONNREFUSED') });
      throw error;
    });

    const result = await runDeploySmoke(BASE, fetchImpl);

    expect(result.failures[0]).toBe(
      '/: request failed (fetch failed: connect ECONNREFUSED)'
    );
  });
});
