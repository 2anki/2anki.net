/**
 * Attribution the web app stores in the `ad_click` cookie when a visitor lands
 * from an ad (Google click ids + utm_* + landing path). Parsed here once so the
 * same sanitized shape reaches Stripe Checkout metadata, the signup row and the
 * funnel events.
 */
export type AdClickAttribution = Partial<
  Record<
    | 'gclid'
    | 'gbraid'
    | 'wbraid'
    | 'utm_source'
    | 'utm_medium'
    | 'utm_campaign'
    | 'utm_term'
    | 'utm_content'
    | 'landing',
    string
  >
>;

type Rule = { pattern: RegExp; lowercase: boolean };

const CLICK_ID: Rule = { pattern: /^[A-Za-z0-9_-]{1,200}$/, lowercase: false };
const UTM: Rule = { pattern: /^[\w .:/+-]{1,100}$/, lowercase: true };

const RULES = new Map<Exclude<keyof AdClickAttribution, 'landing'>, Rule>([
  ['gclid', CLICK_ID],
  ['gbraid', CLICK_ID],
  ['wbraid', CLICK_ID],
  ['utm_source', UTM],
  ['utm_medium', UTM],
  ['utm_campaign', UTM],
  ['utm_term', UTM],
  ['utm_content', UTM],
]);

const LANDING_SHAPE = /^\/(?!\/)[a-zA-Z0-9\-_/]{0,199}$/;
const TWO_SEGMENT_PREFIXES = new Set(['convert', 'answers']);

/**
 * Reduce a landing pathname to the segments that name a public page: the
 * first segment, plus the second under /convert/ and /answers/. Ids and
 * tokens only ever appear deeper (/s/:token, /preview/apkg/:key,
 * /mindmaps/:id), so they never reach storage. Mirrored in
 * web/src/lib/adClick.ts.
 */
export function publicLandingPath(pathname: unknown): string | null {
  if (typeof pathname !== 'string' || !LANDING_SHAPE.test(pathname)) {
    return null;
  }
  const segments = pathname.split('/').filter((part) => part.length > 0);
  if (segments.length === 0) {
    return '/';
  }
  const depth = TWO_SEGMENT_PREFIXES.has(segments[0].toLowerCase()) ? 2 : 1;
  return `/${segments.slice(0, depth).join('/')}/`;
}

function sanitize(read: (key: string) => unknown): AdClickAttribution {
  const result: AdClickAttribution = {};
  for (const [key, rule] of RULES) {
    const value = read(key);
    if (typeof value === 'string' && rule.pattern.test(value)) {
      result[key] = rule.lowercase ? value.toLowerCase() : value;
    }
  }
  const landing = publicLandingPath(read('landing'));
  if (landing != null) {
    result.landing = landing;
  }
  return result;
}

function decode(raw: string): unknown {
  let text = raw;
  try {
    text = decodeURIComponent(raw);
  } catch {
    return null;
  }
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

export function parseAdClick(raw: unknown): AdClickAttribution {
  if (typeof raw !== 'string' || raw.length === 0) {
    return {};
  }
  const parsed = decode(raw);
  if (parsed == null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return {};
  }
  const record = parsed as Record<string, unknown>;
  return sanitize((key) =>
    Object.prototype.hasOwnProperty.call(record, key) ? record[key] : undefined
  );
}

/**
 * Re-validate the attribution keys read back from a Stripe session's metadata
 * before they land in an event row. Same rules as the cookie parser.
 */
export function pickAdClickMetadata(
  metadata: Record<string, string | undefined>
): AdClickAttribution {
  return sanitize((key) => metadata[key]);
}

const EVENT_KEYS = [
  'gclid',
  'gbraid',
  'wbraid',
  'utm_source',
  'utm_medium',
  'utm_campaign',
] as const;

/**
 * The subset worth carrying on funnel events. The events sink strips any key
 * matching /content/ (so utm_content would vanish) and drops a whole event
 * whose props pass 1 KB, so the free-text utm_term / utm_content and the
 * landing path stay in Stripe metadata and on the user row only.
 */
export function adClickEventProps(
  attribution: AdClickAttribution
): Record<string, string> {
  const props: Record<string, string> = {};
  for (const key of EVENT_KEYS) {
    const value = attribution[key];
    if (value != null) {
      props[key] = value;
    }
  }
  return props;
}

/**
 * Honours a later withdrawal of consent: the browser only writes `ad_click`
 * while `cookie_consent` is granted, but the stored cookie outlives a deny,
 * so the server ignores it unless consent still reads granted.
 */
export function readAdClickCookie(req: {
  cookies?: unknown;
}): AdClickAttribution | undefined {
  const cookies = req.cookies as Record<string, unknown> | undefined;
  if (cookies?.cookie_consent !== 'granted') {
    return undefined;
  }
  const parsed = parseAdClick(cookies?.ad_click);
  return Object.keys(parsed).length > 0 ? parsed : undefined;
}
