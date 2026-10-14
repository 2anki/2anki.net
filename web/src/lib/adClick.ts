export const AD_CLICK_COOKIE = 'ad_click';
export const COOKIE_CONSENT_COOKIE = 'cookie_consent';

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
const PUBLIC_LANDING_PATTERN =
  /^\/(?!\/)(?!s\/)(?!preview\/)[a-zA-Z0-9\-_/]{0,199}$/;

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
  const landing = PUBLIC_LANDING_PATTERN.test(pathname)
    ? { landing: pathname }
    : {};
  const payload = JSON.stringify({ ...params, ...landing });
  const value = encodeURIComponent(payload);
  const secureFlag = secure ? '; Secure' : '';
  return `${AD_CLICK_COOKIE}=${value}; Max-Age=${MAX_AGE_SECONDS}; Path=/; SameSite=Lax${secureFlag}`;
}

interface AdClickDocument {
  cookie: string;
  location: { pathname: string; search: string; protocol: string };
}

/**
 * Writes the attribution cookie only once marketing cookies are consented to
 * (`cookie_consent=granted`, set by the consent banner). Without that cookie
 * this is a no-op, so no click data is stored before the visitor agreed.
 */
export function captureAdClick(
  doc: AdClickDocument | null = typeof document === 'undefined'
    ? null
    : document
): void {
  if (doc == null || !hasMarketingConsent(doc.cookie)) {
    return;
  }
  const next = buildAdClickCookie(
    doc.cookie,
    doc.location.search,
    doc.location.pathname,
    doc.location.protocol === 'https:'
  );
  if (next == null) {
    return;
  }
  doc.cookie = next;
}
