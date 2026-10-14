export const AD_CLICK_COOKIE = 'ad_click';

const MAX_AGE_SECONDS = 90 * 24 * 60 * 60;
const MAX_VALUE_LENGTH = 200;

const AD_CLICK_PARAMS = [
  'gclid',
  'gbraid',
  'wbraid',
  'utm_source',
  'utm_medium',
  'utm_campaign',
  'utm_term',
  'utm_content',
] as const;

export type AdClickParam = (typeof AD_CLICK_PARAMS)[number];

export type AdClickParams = Partial<Record<AdClickParam, string>>;

export function readAdClickParams(search: string): AdClickParams | null {
  const query = new URLSearchParams(search);
  const found: AdClickParams = {};
  for (const key of AD_CLICK_PARAMS) {
    const value = query.get(key);
    if (value != null && value.length > 0 && value.length <= MAX_VALUE_LENGTH) {
      found[key] = value;
    }
  }
  return Object.keys(found).length > 0 ? found : null;
}

export function buildAdClickCookie(
  search: string,
  pathname: string,
  secure: boolean
): string | null {
  const params = readAdClickParams(search);
  if (params == null) {
    return null;
  }
  const payload = JSON.stringify({ ...params, landing: pathname });
  const value = encodeURIComponent(payload);
  const secureFlag = secure ? '; Secure' : '';
  return `${AD_CLICK_COOKIE}=${value}; Max-Age=${MAX_AGE_SECONDS}; Path=/; SameSite=Lax${secureFlag}`;
}

interface AdClickDocument {
  cookie: string;
  location: { pathname: string; search: string; protocol: string };
}

export function captureAdClick(
  doc: AdClickDocument | null = typeof document === 'undefined'
    ? null
    : document
): void {
  if (doc == null) {
    return;
  }
  const next = buildAdClickCookie(
    doc.location.search,
    doc.location.pathname,
    doc.location.protocol === 'https:'
  );
  if (next == null) {
    return;
  }
  doc.cookie = next;
}
