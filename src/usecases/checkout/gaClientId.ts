/**
 * Extract the GA4 client_id from the Google Analytics `_ga` cookie so it can
 * land in Stripe Checkout session metadata as `ga_client_id`. The webhook reads
 * it back to stitch the server-side `purchase` event to the user's GA session.
 *
 * The `_ga` cookie value looks like `GA1.1.1234567890.987654321`; GA4's
 * Measurement Protocol expects only the trailing `<random>.<timestamp>` pair as
 * the client_id, not the `GA1.1.` version/scope prefix. Anything that does not
 * match that shape returns undefined so nothing arbitrary reaches metadata.
 */
import type express from 'express';
import { trackingAllowedFor } from '../../lib/http/consentRegion';

export function parseGaClientId(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }
  const match = value.match(/^GA\d+\.\d+\.(\d+\.\d+)$/);
  return match ? match[1] : undefined;
}

export const GA_SESSION_COOKIE = '_ga_X6K69TY3EX';

const SESSION_ID_NEW_FORMAT = /^GS\d+\.\d+\.s(\d{1,20})(?:\D|$)/;
const SESSION_ID_LEGACY_FORMAT = /^GS\d+\.\d+\.(\d{1,20})\./;

/**
 * Extract the GA4 session_id from the per-stream `_ga_<container>` cookie so a
 * server-side Measurement Protocol event can be stitched to the visitor's GA
 * session. Two shapes exist in the wild: the newer `GS2.1.s<session_id>$...`
 * and the legacy `GS1.1.<session_id>.<count>.…`. The session_id is a Unix
 * timestamp in seconds; anything that is not a bounded run of digits in that
 * position returns undefined so nothing arbitrary reaches metadata.
 */
export function parseGaSessionId(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }
  const match =
    value.match(SESSION_ID_NEW_FORMAT) ?? value.match(SESSION_ID_LEGACY_FORMAT);
  return match ? match[1] : undefined;
}

export interface GaMeasurement {
  gaClientId?: string;
  gaSessionId?: string;
}

/**
 * Read the GA4 client_id and session_id from the request cookies, honouring the
 * same consent gate as the ad-click attribution path: an explicit
 * `cookie_consent` wins, otherwise the visitor's region decides. Returns an
 * empty object when tracking is not allowed or neither cookie is present.
 */
export function readGaMeasurement(req: express.Request): GaMeasurement {
  const cookies = req.cookies as Record<string, unknown> | undefined;
  const rawClient = cookies?._ga;
  const rawSession = cookies?.[GA_SESSION_COOKIE];
  if (typeof rawClient !== 'string' && typeof rawSession !== 'string') {
    return {};
  }
  if (!trackingAllowedFor(req)) {
    return {};
  }
  const result: GaMeasurement = {};
  const gaClientId = parseGaClientId(rawClient);
  if (gaClientId != null) {
    result.gaClientId = gaClientId;
  }
  const gaSessionId = parseGaSessionId(rawSession);
  if (gaSessionId != null) {
    result.gaSessionId = gaSessionId;
  }
  return result;
}
