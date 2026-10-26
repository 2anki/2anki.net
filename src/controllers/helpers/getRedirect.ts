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

export const getRedirect = (req: Request): string => {
  const queryRedirect = req.query.redirect?.toString();
  const bodyRedirect =
    typeof req.body?.redirect === 'string' ? req.body.redirect : undefined;
  const redirectParam = queryRedirect ?? bodyRedirect;

  if (redirectParam == null || redirectParam === '') {
    return DEFAULT_REDIRECT;
  }

  // A connector authorize request needs its whole query (client_id,
  // redirect_uri, state, code_challenge) to resume, so it keeps the full
  // value instead of collapsing to an allowlisted section root.
  return (
    asMcpAuthorizeReturn(redirectParam) ??
    resolveInternalPath(redirectParam) ??
    resolveAllowedOrigin(redirectParam) ??
    DEFAULT_REDIRECT
  );
};
