export interface PageExpectation {
  path: string;
  canonical: string;
}

export interface PageResponse {
  status: number;
  body: string;
}

export interface SampleDeckResponse {
  status: number;
  cardCount: string | null;
  body: Buffer;
}

export interface PageHead {
  title: string | null;
  canonical: string | null;
}

const HOME_PATH = '/';
const TITLE = /<title>([\s\S]*?)<\/title>/i;
const LINK_TAG = /<link\b[^>]*>/gi;
const MODULE_SCRIPT = /<script\b[^>]*\btype="module"[^>]*>/i;
const APP_ROOT = '<div id="root"';
const ZIP_MAGIC = Buffer.from([0x50, 0x4b, 0x03, 0x04]);
const ERROR_EXCERPT_BYTES = 200;

function attribute(tag: string, name: string): string | null {
  const match = new RegExp(`\\b${name}="([^"]*)"`, 'i').exec(tag);
  return match == null ? null : match[1];
}

export function readHead(html: string): PageHead {
  const titleMatch = TITLE.exec(html);
  const canonicalTag = (html.match(LINK_TAG) ?? []).find(
    (tag) => attribute(tag, 'rel')?.toLowerCase() === 'canonical'
  );
  return {
    title: titleMatch == null ? null : titleMatch[1].trim(),
    canonical: canonicalTag == null ? null : attribute(canonicalTag, 'href'),
  };
}

export function findAppBundleSrc(html: string): string | null {
  const tag = MODULE_SCRIPT.exec(html);
  return tag == null ? null : attribute(tag[0], 'src');
}

export function checkPage(
  expected: PageExpectation,
  response: PageResponse,
  homeTitle: string | null
): string[] {
  const { path } = expected;
  if (response.status !== 200) {
    return [`${path}: HTTP ${response.status}, expected 200`];
  }
  const failures: string[] = [];
  const html = response.body;
  if (!html.includes(APP_ROOT)) {
    failures.push(`${path}: no <div id="root">, not the app shell`);
  }
  if (findAppBundleSrc(html) == null) {
    failures.push(`${path}: no module script, the app bundle is not loaded`);
  }
  const head = readHead(html);
  if (head.canonical == null) {
    failures.push(`${path}: no canonical link, expected ${expected.canonical}`);
  } else if (head.canonical !== expected.canonical) {
    failures.push(
      `${path}: canonical is ${head.canonical}, expected ${expected.canonical}`
    );
  }
  if (head.title == null || head.title === '') {
    failures.push(`${path}: no <title>`);
  } else if (path !== HOME_PATH && head.title === homeTitle) {
    failures.push(
      `${path}: serves the home page title, so the home shell was sent instead of its prerendered page`
    );
  }
  return failures;
}

export function checkSampleDeck(
  response: SampleDeckResponse,
  expectedCards: number
): string[] {
  if (response.status !== 200) {
    const excerpt = response.body
      .subarray(0, ERROR_EXCERPT_BYTES)
      .toString('utf8')
      .replace(/\s+/g, ' ')
      .trim();
    return [
      `sample conversion: HTTP ${response.status}, expected 200 (body: ${excerpt})`,
    ];
  }
  const failures: string[] = [];
  if (!response.body.subarray(0, ZIP_MAGIC.length).equals(ZIP_MAGIC)) {
    failures.push('sample conversion: response is not an .apkg (zip) file');
  }
  if (response.cardCount == null) {
    failures.push(
      `sample conversion: no X-Card-Count header, expected ${expectedCards}`
    );
  } else if (response.cardCount !== String(expectedCards)) {
    failures.push(
      `sample conversion: ${response.cardCount} cards, expected ${expectedCards}`
    );
  }
  return failures;
}
