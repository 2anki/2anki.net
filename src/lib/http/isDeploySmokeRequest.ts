import type express from 'express';

export const DEPLOY_SMOKE_HEADER = 'x-2anki-deploy-smoke';

const LOOPBACK_ADDRESSES = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);

/**
 * The deploy smoke check talks to the new color on its loopback port before
 * Apache routes any traffic to it. Apache adds X-Forwarded-For to every
 * request it proxies, so a request that carries the smoke header, arrives on
 * loopback and has no X-Forwarded-For came from the box itself. Only analytics
 * consult this; it never lifts a limit.
 */
export function isDeploySmokeRequest(req: express.Request): boolean {
  const headers = req.headers ?? {};
  const remoteAddress = req.socket?.remoteAddress ?? '';
  return (
    headers[DEPLOY_SMOKE_HEADER] === '1' &&
    headers['x-forwarded-for'] == null &&
    LOOPBACK_ADDRESSES.has(remoteAddress)
  );
}
