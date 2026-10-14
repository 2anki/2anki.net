import { AD_CLICK_COOKIE, COOKIE_CONSENT_COOKIE } from './consent/cookies';

export { AD_CLICK_COOKIE, COOKIE_CONSENT_COOKIE };

const MAX_AGE_SECONDS = 90 * 24 * 60 * 60;

const CLICK_ID_PARAMS = ['gclid', 'gbraid', 'wbraid'] as const;
const UTM_PARAMS = [
  'utm_source',
  'utm_medium',
  'utm_campaign',
  'utm_term',
  'utm_content',
] as const;
const AD_CLICK_PARAMS = [...CLICK_ID_PARAMS, ...UTM_PARAMS] as const;

// Mirrors the server-side rules in src/lib/attribution/adClick.ts so nothing
// leaves the browser that the server would drop anyway.
const CLICK_ID_PATTERN = /^[A-Za-z0-9_-]{1,200}$/;
const UTM_PATTERN = /^[\w .:/+-]{1,100}$/;
const LANDING_SHAPE = /^\/(?!\/)[a-zA-Z0-9\-_/]{0,199}$/;
const TWO_SEGMENT_PREFIXES = new Set(['convert', 'answers']);

// Same reduction as src/lib/attribution/adClick.ts: first segment, plus the
// second under /convert/ and /answers/. Ids and tokens live deeper and never
// enter the cookie.
export function publicLandingPath(pathname: string): string | null {
  if (!LANDING_SHAPE.test(pathname)) {
    return null;
  }
  const segments = pathname.split('/').filter((part) => part.length > 0);
  if (segments.length === 0) {
    return '/';
  }
  const depth = TWO_SEGMENT_PREFIXES.has(segments[0].toLowerCase()) ? 2 : 1;
  return `/${segments.slice(0, depth).join('/')}/`;
}

interface AdClickDocument {
  cookie: string;
  location: { pathname: string; search: string; protocol: string };
  documentElement?: { dataset: { consentRegion?: string } };
}

export type AdClickParam = (typeof AD_CLICK_PARAMS)[number];

export type AdClickParams = Partial<Record<AdClickParam, string>>;

function readCookie(cookieHeader: string, name: string): string | null {
  for (const entry of cookieHeader.split(';')) {
    const trimmed = entry.trim();
    if (trimmed.startsWith(`${name}=`)) {
      return trimmed.slice(name.length + 1);
    }
  }
  return null;
}

export function hasMarketingConsent(cookieHeader: string): boolean {
  return readCookie(cookieHeader, COOKIE_CONSENT_COOKIE) === 'granted';
}

/**
 * Same rule as consent.ts getEffectiveConsent, without importing it: an
 * explicit choice wins; with none, the server-stamped region decides (consent
 * is implied outside the EEA/UK/CH, required inside).
 */
function marketingAllowed(doc: AdClickDocument): boolean {
  const stored = readCookie(doc.cookie, COOKIE_CONSENT_COOKIE);
  if (stored === 'granted') {
    return true;
  }
  if (stored === 'denied') {
    return false;
  }
  return doc.documentElement?.dataset.consentRegion === 'other';
}

function hasClickId(params: AdClickParams): boolean {
  return CLICK_ID_PARAMS.some((key) => params[key] != null);
}

function storedClickHasId(cookieHeader: string): boolean {
  const raw = readCookie(cookieHeader, AD_CLICK_COOKIE);
  if (raw == null) {
    return false;
  }
  try {
    const parsed: unknown = JSON.parse(decodeURIComponent(raw));
    return (
      parsed != null &&
      typeof parsed === 'object' &&
      hasClickId(parsed as AdClickParams)
    );
  } catch {
    return false;
  }
}

export function readAdClickParams(search: string): AdClickParams | null {
  const query = new URLSearchParams(search);
  const found: AdClickParams = {};
  for (const key of CLICK_ID_PARAMS) {
    const value = query.get(key);
    if (value != null && CLICK_ID_PATTERN.test(value)) {
      found[key] = value;
    }
  }
  for (const key of UTM_PARAMS) {
    const value = query.get(key);
    if (value != null && UTM_PATTERN.test(value)) {
      found[key] = value;
    }
  }
  return Object.keys(found).length > 0 ? found : null;
}

/**
 * Last click wins, with one exception: a plain utm-tagged link (newsletter,
 * email) never replaces a stored Google click id, or the Ads match is lost.
 */
export function buildAdClickCookie(
  cookieHeader: string,
  search: string,
  pathname: string,
  secure: boolean
): string | null {
  const params = readAdClickParams(search);
  if (params == null) {
    return null;
  }
  if (!hasClickId(params) && storedClickHasId(cookieHeader)) {
    return null;
  }
  const publicPath = publicLandingPath(pathname);
  const landing = publicPath == null ? {} : { landing: publicPath };
  const payload = JSON.stringify({ ...params, ...landing });
  const value = encodeURIComponent(payload);
  const secureFlag = secure ? '; Secure' : '';
  return `${AD_CLICK_COOKIE}=${value}; Max-Age=${MAX_AGE_SECONDS}; Path=/; SameSite=Lax${secureFlag}`;
}

/**
 * Writes the attribution cookie only once marketing cookies are consented to
 * (`cookie_consent=granted`; the consent banner that sets it is a follow-up
 * change). Without that cookie this is a no-op, so no click data is stored
 * before the visitor agreed.
 */
export function captureAdClick(
  doc: AdClickDocument | null = typeof document === 'undefined'
    ? null
    : document,
  landing: { search: string; pathname: string } | null = null
): void {
  if (doc == null || !marketingAllowed(doc)) {
    return;
  }
  const next = buildAdClickCookie(
    doc.cookie,
    landing?.search ?? doc.location.search,
    landing?.pathname ?? doc.location.pathname,
    doc.location.protocol === 'https:'
  );
  if (next == null) {
    return;
  }
  doc.cookie = next;
}

/**
 * The visitor usually answers the banner after the SPA has already navigated
 * away from the landing URL, so the landing search and path are remembered
 * from first load and replayed when consent arrives.
 */
export function rememberLanding(
  doc: AdClickDocument | null = typeof document === 'undefined'
    ? null
    : document
): { search: string; pathname: string } | null {
  if (doc == null) {
    return null;
  }
  return { search: doc.location.search, pathname: doc.location.pathname };
}
