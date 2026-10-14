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
// Public landing pages only: no protocol-relative `//`, and never the
// token-bearing share (/s/) or preview (/preview/) routes.
const LANDING: Rule = {
  pattern: /^\/(?!\/)(?!s\/)(?!preview\/)[a-zA-Z0-9\-_/]{0,199}$/,
  lowercase: false,
};

const RULES = new Map<keyof AdClickAttribution, Rule>([
  ['gclid', CLICK_ID],
  ['gbraid', CLICK_ID],
  ['wbraid', CLICK_ID],
  ['utm_source', UTM],
  ['utm_medium', UTM],
  ['utm_campaign', UTM],
  ['utm_term', UTM],
  ['utm_content', UTM],
  ['landing', LANDING],
]);

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
  const result: AdClickAttribution = {};
  for (const [key, rule] of RULES) {
    if (!Object.prototype.hasOwnProperty.call(record, key)) {
      continue;
    }
    const value = record[key];
    if (typeof value !== 'string' || !rule.pattern.test(value)) {
      continue;
    }
    result[key] = rule.lowercase ? value.toLowerCase() : value;
  }
  return result;
}

/**
 * Re-validate the attribution keys read back from a Stripe session's metadata
 * before they land in an event row. Same rules as the cookie parser.
 */
export function pickAdClickMetadata(
  metadata: Record<string, string | undefined>
): AdClickAttribution {
  const result: AdClickAttribution = {};
  for (const [key, rule] of RULES) {
    const value = metadata[key];
    if (typeof value === 'string' && rule.pattern.test(value)) {
      result[key] = rule.lowercase ? value.toLowerCase() : value;
    }
  }
  return result;
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
 * The subset worth carrying on funnel events: the events sink strips any key
 * matching /content/ and drops a whole event whose props pass 1 KB, so
 * utm_term, utm_content and landing stay in Stripe metadata only.
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

export function readAdClickCookie(req: {
  cookies?: unknown;
}): AdClickAttribution | undefined {
  const cookies = req.cookies as Record<string, unknown> | undefined;
  const parsed = parseAdClick(cookies?.ad_click);
  return Object.keys(parsed).length > 0 ? parsed : undefined;
}
