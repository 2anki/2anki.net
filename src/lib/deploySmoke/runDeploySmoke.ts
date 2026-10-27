import { DEPLOY_SMOKE_HEADER } from '../http/isDeploySmokeRequest';
import { SAMPLE_DECK_CARD_COUNT } from '../upload/sampleDeck';
import {
  checkPage,
  checkSampleDeck,
  findAppBundleSrc,
  PageExpectation,
  readHead,
} from './smokeChecks';

export type SmokeFetch = (url: string, init?: RequestInit) => Promise<Response>;

export interface DeploySmokeResult {
  passed: string[];
  failures: string[];
}

export const DEPLOY_SMOKE_PAGES: PageExpectation[] = [
  { path: '/', canonical: 'https://2anki.net/' },
  { path: '/upload/', canonical: 'https://2anki.net/upload/' },
  { path: '/pricing/', canonical: 'https://2anki.net/pricing/' },
  { path: '/pdf-to-anki/', canonical: 'https://2anki.net/pdf-to-anki/' },
  { path: '/notion-to-anki/', canonical: 'https://2anki.net/notion-to-anki/' },
  { path: '/convert/', canonical: 'https://2anki.net/convert/' },
  {
    path: '/convert/csv-to-anki/',
    canonical: 'https://2anki.net/convert/csv-to-anki/',
  },
  {
    path: '/convert/html-to-anki/',
    canonical: 'https://2anki.net/convert/html-to-anki/',
  },
  {
    path: '/answers/convert-notion-to-anki/',
    canonical: 'https://2anki.net/answers/convert-notion-to-anki/',
  },
];

const PAGE_TIMEOUT_MS = 15_000;
const CONVERSION_TIMEOUT_MS = 120_000;
const SMOKE_ORIGIN = 'https://2anki.net';
const SMOKE_USER_AGENT = '2anki-deploy-smoke';

function describeError(error: unknown): string {
  if (!(error instanceof Error)) {
    return String(error);
  }
  const cause: unknown = 'cause' in error ? error.cause : undefined;
  return cause instanceof Error
    ? `${error.message}: ${cause.message}`
    : error.message;
}

export async function runDeploySmoke(
  baseUrl: string,
  fetchImpl: SmokeFetch
): Promise<DeploySmokeResult> {
  const result: DeploySmokeResult = { passed: [], failures: [] };
  const record = (label: string, failures: string[]) => {
    if (failures.length === 0) {
      result.passed.push(label);
    } else {
      result.failures.push(...failures);
    }
  };
  const probe = async (label: string, run: () => Promise<string[]>) => {
    try {
      record(label, await run());
    } catch (error) {
      result.failures.push(
        `${label}: request failed (${describeError(error)})`
      );
    }
  };

  let homeHtml: string | null = null;
  let homeTitle: string | null = null;
  for (const expected of DEPLOY_SMOKE_PAGES) {
    await probe(expected.path, async () => {
      const response = await fetchImpl(`${baseUrl}${expected.path}`, {
        redirect: 'manual',
        headers: { 'User-Agent': SMOKE_USER_AGENT },
        signal: AbortSignal.timeout(PAGE_TIMEOUT_MS),
      });
      const body = await response.text();
      if (expected.path === '/') {
        homeHtml = body;
        homeTitle = readHead(body).title;
      }
      return checkPage(expected, { status: response.status, body }, homeTitle);
    });
  }

  const bundleSrc = homeHtml == null ? null : findAppBundleSrc(homeHtml);
  if (bundleSrc != null) {
    const bundleUrl = new URL(bundleSrc, baseUrl).toString();
    await probe('app bundle', async () => {
      const response = await fetchImpl(bundleUrl, {
        headers: { 'User-Agent': SMOKE_USER_AGENT },
        signal: AbortSignal.timeout(PAGE_TIMEOUT_MS),
      });
      await response.arrayBuffer();
      return response.status === 200
        ? []
        : [
            `app bundle: ${bundleUrl} returned HTTP ${response.status}, expected 200`,
          ];
    });
  }

  await probe('sample conversion', async () => {
    const response = await fetchImpl(`${baseUrl}/api/upload/sample`, {
      method: 'POST',
      headers: {
        Origin: SMOKE_ORIGIN,
        'User-Agent': SMOKE_USER_AGENT,
        [DEPLOY_SMOKE_HEADER]: '1',
      },
      signal: AbortSignal.timeout(CONVERSION_TIMEOUT_MS),
    });
    const body = Buffer.from(await response.arrayBuffer());
    return checkSampleDeck(
      {
        status: response.status,
        cardCount: response.headers.get('X-Card-Count'),
        body,
      },
      SAMPLE_DECK_CARD_COUNT
    );
  });

  return result;
}
