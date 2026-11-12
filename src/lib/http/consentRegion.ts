import type express from 'express';
import geoip from 'geoip-lite';
import { resolveClientIp } from '../rateLimit/ipHelpers';

export type ConsentRegion = 'eea' | 'other';

// EU 27 + EEA (IS, LI, NO) + UK + Switzerland: where a cookie banner with a
// real choice is required before marketing or analytics cookies are set.
const CONSENT_REQUIRED_COUNTRIES: ReadonlySet<string> = new Set([
  'AT',
  'BE',
  'BG',
  'HR',
  'CY',
  'CZ',
  'DK',
  'EE',
  'FI',
  'FR',
  'DE',
  'GR',
  'HU',
  'IE',
  'IT',
  'LV',
  'LT',
  'LU',
  'MT',
  'NL',
  'PL',
  'PT',
  'RO',
  'SK',
  'SI',
  'ES',
  'SE',
  'IS',
  'LI',
  'NO',
  'GB',
  'CH',
]);

/**
 * Unknown country → treat as EEA. Showing the banner to someone who did not
 * need it costs a click; skipping it for someone who did is a violation.
 */
export function consentRegionFor(country: string | null): ConsentRegion {
  if (country == null || country.length === 0) {
    return 'eea';
  }
  return CONSENT_REQUIRED_COUNTRIES.has(country.toUpperCase())
    ? 'eea'
    : 'other';
}

/**
 * Resolved from the client IP only. The CDN country headers that
 * extractCountryFromRequest also accepts are not stripped by the Apache in
 * front of this box, so a visitor could send `cf-ipcountry: US` and skip the
 * banner. The proxy-resolved IP (`trust proxy` 1 behind Apache) ignores a
 * client-prepended X-Forwarded-For; forging it would need a direct connection
 * to the Node port, which the host firewall only allows from the box itself.
 */
export function countryFromClientIp(req: express.Request): string | null {
  return geoip.lookup(resolveClientIp(req))?.country ?? null;
}

export function consentRegionForRequest(req: express.Request): ConsentRegion {
  return consentRegionFor(countryFromClientIp(req));
}

/**
 * Mirrors the browser rule for analytics and marketing cookies: an explicit
 * `cookie_consent` wins; with none, consent is implied outside the EEA/UK/CH
 * and required inside.
 */
export function trackingAllowedFor(req: express.Request): boolean {
  const cookies = req.cookies as Record<string, unknown> | undefined;
  const consent = cookies?.cookie_consent;
  if (consent === 'granted') {
    return true;
  }
  if (consent === 'denied') {
    return false;
  }
  return consentRegionForRequest(req) === 'other';
}

/**
 * The anon_id cookie is functional (held decks, anonymous limits, pass
 * binding) and is kept for everyone; only its copy on an analytics event is
 * subject to consent, the same rule the client events ingest applies.
 */
export function analyticsAnonId(
  req: express.Request,
  anonId: string | null | undefined
): string | null {
  if (anonId == null || anonId.length === 0) {
    return null;
  }
  return trackingAllowedFor(req) ? anonId : null;
}
