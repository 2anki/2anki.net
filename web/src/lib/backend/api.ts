import handleRedirect from '../handleRedirect';
import { UserNotice, isIntentionalBackendNotice } from '../errors/UserNotice';
import { NOT_FOUND, UNAUTHORIZED } from './http';

interface ClientSideOptions {
  redirect?: boolean;
}

// Pages reachable without a session. A 401 fired from any of these
// shouldn't bounce the user to /login — the page itself works for
// anons, so a background 401 is fine to swallow.
const NON_AUTH_PATHS = [
  '/',
  '/login',
  '/register',
  '/forgot',
  '/users/r',
  '/auth/magic',
  '/upload',
  '/card-options',
  '/templates',
  '/pricing',
  '/about',
  '/contact',
  '/documentation',
  '/debug',
  '/successful-checkout',
];

function isNonAuthPath(pathname: string): boolean {
  return NON_AUTH_PATHS.some((prefix) => {
    if (prefix === '/') return pathname === '/';
    return pathname === prefix || pathname.startsWith(`${prefix}/`);
  });
}

function redirectToLogin() {
  const currentPath = globalThis.location?.pathname ?? '';
  if (isNonAuthPath(currentPath)) return;
  globalThis.location.href = '/login';
}

export const getLoginURL = (baseURL: string) => `${baseURL}users/login`;

export const post = async (url: string, body: unknown) =>
  fetch(url, {
    method: 'POST',
    credentials: 'include',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

export const postMultipart = async (url: string, formData: FormData) =>
  fetch(url, {
    method: 'POST',
    credentials: 'include',
    body: formData,
  });

export const patch = async (url: string, body: unknown) =>
  fetch(url, {
    method: 'PATCH',
    credentials: 'include',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

const DEFAULT_GET_OPTIONS: ClientSideOptions = { redirect: true };

export const get = async (
  url: string,
  options: ClientSideOptions = DEFAULT_GET_OPTIONS
) => {
  let response: Response;
  try {
    response = await fetch(url, { credentials: 'include' });
  } catch (cause) {
    throw taggedHttpError(
      `Network error on GET ${pathOf(url)}: ${cause instanceof Error ? cause.message : String(cause)}`,
      'GET',
      url,
      0
    );
  }

  if (options.redirect && handleRedirect(response)) {
    return undefined;
  }

  if (!response.ok) {
    await throwForErrorResponse(response, url);
  }

  return response.json();
};

function throwForUnauthorized(body: {
  code?: unknown;
  message?: unknown;
}): never {
  const code = typeof body.code === 'string' ? body.code : undefined;
  const message = typeof body.message === 'string' ? body.message : undefined;
  if (code === 'notion_unauthorized' || isIntentionalBackendNotice(message)) {
    throw new UserNotice(message ?? 'Unauthorized', code);
  }
  redirectToLogin();
  throw new UserNotice('Unauthorized');
}

async function throwForErrorResponse(
  response: Response,
  url: string
): Promise<never> {
  if (response.status === UNAUTHORIZED) {
    throwForUnauthorized(await response.json().catch(() => ({})));
  }
  if (response.status === NOT_FOUND) {
    throw taggedHttpError(
      `Resource not found: GET ${pathOf(url)} status: ${response.status} ${response.statusText}`,
      'GET',
      url,
      response.status
    );
  }
  const errorData = await response
    .json()
    .catch(() => ({ message: response.statusText }));
  if (isIntentionalBackendNotice(errorData.message)) {
    throw new UserNotice(errorData.message, errorData.code);
  }
  throw taggedHttpError(
    `HTTP error! GET ${pathOf(url)} status: ${response.status}, message: ${errorData.message}`,
    'GET',
    url,
    response.status
  );
}

export function pathOf(url: string): string {
  try {
    return new URL(url, globalThis.location?.origin ?? 'http://localhost')
      .pathname;
  } catch {
    return url;
  }
}

function taggedHttpError(
  message: string,
  method: string,
  url: string,
  status: number
): Error {
  const err = new Error(message) as Error & {
    url?: string;
    method?: string;
    status?: number;
  };
  err.url = pathOf(url);
  err.method = method;
  err.status = status;
  return err;
}

const DEFAULT_DELETE_OPTIONS: ClientSideOptions = { redirect: true };

export const del = async (
  url: string,
  options: ClientSideOptions = DEFAULT_DELETE_OPTIONS
) => {
  const response = await fetch(url, {
    method: 'DELETE',
    credentials: 'include',
  });
  if (options.redirect && handleRedirect(response)) {
    return null;
  }
  return response;
};
