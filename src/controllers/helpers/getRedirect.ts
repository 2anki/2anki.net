import { Request } from 'express';
import { ALLOWED_ORIGINS } from '../../lib/constants';
import { asMcpAuthorizeReturn } from '../../lib/mcp/loginReturn';
import {
  CONNECTOR_REF,
  CONNECTOR_RETURN_MARKER,
  CONNECTOR_RETURN_VALUE,
  readConnectorLinkParams,
} from '../../lib/mcp/connectorLink';

const DEFAULT_REDIRECT = '/upload';

const DOWNLOAD_PATH_PREFIX = '/api/download/u/';
const DOWNLOAD_PATH = /^\/api\/download\/u\/[A-Za-z0-9._-]+$/;

const ALLOWED_REDIRECT_PATHS = [
  '/notion',
  '/search',
  '/upload',
  '/downloads',
  '/favorites',
  '/templates',
  '/pricing',
  '/settings',
  '/anki',
  '/card-options',
  '/print',
  '/photo-to-deck',
];

const ALLOWED_REDIRECT_ORIGINS = ALLOWED_ORIGINS.map((origin) => {
  try {
    return new URL(origin).origin;
  } catch {
    return origin;
  }
});

const resolveInternalPath = (candidate: string): string | null => {
  if (candidate.startsWith(DOWNLOAD_PATH_PREFIX)) {
    const isSafeDownloadPath =
      DOWNLOAD_PATH.test(candidate) && !candidate.includes('..');
    return isSafeDownloadPath ? candidate : null;
  }
  const match = ALLOWED_REDIRECT_PATHS.find(
    (allowedPath) =>
      candidate === allowedPath || candidate.startsWith(`${allowedPath}/`)
  );
  return match ?? null;
};

const PRICING_PATHS = new Set(['/pricing', '/pricing/']);
const PRICING_RETURN_PARAMS = new Map([
  ['ref', CONNECTOR_REF],
  ['interval', 'year'],
]);
const PRICING_RETURN_HASHES = new Set(['#auto-sync']);
const SAME_SITE_BASE = 'https://2anki.invalid';

const resolvePricingReturn = (candidate: string): string | null => {
  if (!candidate.startsWith('/pricing')) {
    return null;
  }
  let parsed: URL;
  try {
    parsed = new URL(candidate, SAME_SITE_BASE);
  } catch {
    return null;
  }
  if (parsed.origin !== SAME_SITE_BASE || !PRICING_PATHS.has(parsed.pathname)) {
    return null;
  }
  const kept = new URLSearchParams();
  for (const [key, value] of PRICING_RETURN_PARAMS) {
    if (parsed.searchParams.get(key) === value) {
      kept.set(key, value);
    }
  }
  const connector = readConnectorLinkParams(parsed.searchParams);
  if (connector.kind != null) {
    kept.set('k', connector.kind);
  }
  if (connector.arm != null) {
    kept.set('a', connector.arm);
  }
  if (connector.heldUntil != null) {
    kept.set('held_until', connector.heldUntil);
  }
  if (kept.get('ref') === CONNECTOR_REF) {
    kept.set(CONNECTOR_RETURN_MARKER, CONNECTOR_RETURN_VALUE);
  }
  const query = kept.toString();
  const hash = PRICING_RETURN_HASHES.has(parsed.hash) ? parsed.hash : '';
  return `/pricing${query === '' ? '' : `?${query}`}${hash}`;
};

const LIMIT_PATHS = new Set(['/limit', '/limit/']);
const SIGNED_IN_LIMIT_KINDS = new Set(['card_count', 'file_size']);
const ANONYMOUS_LIMIT_KIND = 'anonymous';

const resolveLimitReturn = (candidate: string): string | null => {
  if (!candidate.startsWith('/limit')) {
    return null;
  }
  let parsed: URL;
  try {
    parsed = new URL(candidate, SAME_SITE_BASE);
  } catch {
    return null;
  }
  if (parsed.origin !== SAME_SITE_BASE || !LIMIT_PATHS.has(parsed.pathname)) {
    return null;
  }
  const kind = parsed.searchParams.get('kind');
  if (kind === ANONYMOUS_LIMIT_KIND) {
    return null;
  }
  if (kind != null && SIGNED_IN_LIMIT_KINDS.has(kind)) {
    return `/limit?kind=${kind}`;
  }
  return '/limit';
};

const resolveAllowedOrigin = (candidate: string): string | null => {
  let parsed: URL;
  try {
    parsed = new URL(candidate);
  } catch {
    return null;
  }

  const isHttps = parsed.protocol === 'https:';
  const isLocalhost = parsed.hostname.includes('localhost');
  if (!isHttps && !isLocalhost) {
    return null;
  }

  return (
    ALLOWED_REDIRECT_ORIGINS.find((origin) => origin === parsed.origin) ?? null
  );
};

export const markConnectorReturn = (
  path: string | undefined
): string | undefined => {
  if (path == null) {
    return path;
  }
  const pricing = resolvePricingReturn(path);
  if (pricing == null) {
    return path;
  }
  const marked = new URL(pricing, SAME_SITE_BASE).searchParams;
  return marked.get(CONNECTOR_RETURN_MARKER) === CONNECTOR_RETURN_VALUE
    ? pricing
    : path;
};

// A connector authorize request needs its whole query (client_id,
// redirect_uri, state, code_challenge) to resume, so it keeps the full
// value instead of collapsing to an allowlisted section root.
export const resolveRedirect = (redirectParam: string): string | null =>
  asMcpAuthorizeReturn(redirectParam) ??
  resolvePricingReturn(redirectParam) ??
  resolveLimitReturn(redirectParam) ??
  resolveInternalPath(redirectParam) ??
  resolveAllowedOrigin(redirectParam);

export const getRedirect = (req: Request): string => {
  const queryRedirect = req.query.redirect?.toString();
  const bodyRedirect =
    typeof req.body?.redirect === 'string' ? req.body.redirect : undefined;
  const redirectParam = queryRedirect ?? bodyRedirect;

  if (redirectParam == null || redirectParam === '') {
    return DEFAULT_REDIRECT;
  }

  return resolveRedirect(redirectParam) ?? DEFAULT_REDIRECT;
};
