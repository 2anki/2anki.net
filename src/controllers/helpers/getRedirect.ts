import { Request } from 'express';
import { ALLOWED_ORIGINS } from '../../lib/constants';
import { asMcpAuthorizeReturn } from '../../lib/mcp/loginReturn';

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
  '/limit',
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
  ['ref', 'mcp'],
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
  const query = kept.toString();
  const hash = PRICING_RETURN_HASHES.has(parsed.hash) ? parsed.hash : '';
  return `/pricing${query === '' ? '' : `?${query}`}${hash}`;
};

const LIMIT_PATHS = new Set(['/limit', '/limit/']);
const LIMIT_KINDS = new Set(['anonymous', 'card_count', 'file_size']);
const LIMIT_CARD_COUNT = /^\d{1,5}$/;

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
  const kept = new URLSearchParams();
  const kind = parsed.searchParams.get('kind');
  if (kind != null && LIMIT_KINDS.has(kind)) {
    kept.set('kind', kind);
  }
  const cards = parsed.searchParams.get('cards');
  if (cards != null && LIMIT_CARD_COUNT.test(cards)) {
    kept.set('cards', cards);
  }
  const query = kept.toString();
  return `/limit${query === '' ? '' : `?${query}`}`;
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
