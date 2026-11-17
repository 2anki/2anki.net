import type { Request, Response } from 'express';

import {
  isBoundToThisBrowser,
  isPrefetchRequest,
  isSameOriginJsonRequest,
  magicLinkBindingCookieName,
  magicLinkBindingFor,
  rememberMagicLinkBinding,
} from './magicLinkBinding';

const DEV_COOKIE = 'magic_link_binding';
const PROD_COOKIE = '__Host-magic_link_binding';

const TOKEN = 'a'.repeat(128);

const request = (overrides: {
  method?: string;
  headers?: Record<string, string>;
  cookies?: Record<string, unknown>;
  json?: boolean;
}): Request =>
  ({
    method: overrides.method ?? 'GET',
    headers: overrides.headers ?? {},
    cookies: overrides.cookies ?? {},
    get(name: string) {
      return (overrides.headers ?? {})[name.toLowerCase()];
    },
    is(type: string) {
      return type === 'application/json' && overrides.json === true
        ? type
        : false;
    },
  }) as unknown as Request;

const response = () => {
  const cookie = vi.fn();
  return { res: { cookie } as unknown as Response, cookie };
};

beforeEach(() => {
  vi.stubEnv('THE_HASHING_SECRET', 'binding-test-secret');
  vi.stubEnv('NODE_ENV', 'test');
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('magicLinkBindingFor', () => {
  it('is a 64-character hex value that does not contain the token', () => {
    const binding = magicLinkBindingFor(TOKEN);

    expect(binding).toMatch(/^[0-9a-f]{64}$/);
    expect(binding).not.toContain(TOKEN.slice(0, 16));
  });

  it('differs per token and per server secret', () => {
    const first = magicLinkBindingFor(TOKEN);
    expect(magicLinkBindingFor('b'.repeat(128))).not.toBe(first);
    vi.stubEnv('THE_HASHING_SECRET', 'another-secret');
    expect(magicLinkBindingFor(TOKEN)).not.toBe(first);
  });
});

describe('isBoundToThisBrowser', () => {
  it('accepts the binding issued for this token', () => {
    const req = request({
      cookies: { [DEV_COOKIE]: magicLinkBindingFor(TOKEN) },
    });

    expect(isBoundToThisBrowser(req, TOKEN)).toBe(true);
  });

  it.each([
    ['no cookie', undefined],
    ['an empty cookie', ''],
    ['the binding of another token', 'other'],
    ['a value of the wrong length', 'abc'],
    ['a non-string cookie', 42],
  ])('treats %s as unbound', (_label, value) => {
    const cookieValue =
      value === 'other' ? magicLinkBindingFor('b'.repeat(128)) : value;
    const req = request({
      cookies: cookieValue === undefined ? {} : { [DEV_COOKIE]: cookieValue },
    });

    expect(isBoundToThisBrowser(req, TOKEN)).toBe(false);
  });

  it('treats a tampered binding as unbound', () => {
    const binding = magicLinkBindingFor(TOKEN);
    const tampered = `${binding.slice(0, -1)}${binding.endsWith('0') ? '1' : '0'}`;
    const req = request({
      cookies: { [DEV_COOKIE]: tampered },
    });

    expect(isBoundToThisBrowser(req, TOKEN)).toBe(false);
  });
});

describe('the binding cookie name', () => {
  it('uses the __Host- prefix in production', () => {
    vi.stubEnv('NODE_ENV', 'production');

    expect(magicLinkBindingCookieName()).toBe(PROD_COOKIE);
  });

  it('uses the bare name outside production, where http cannot carry Secure', () => {
    vi.stubEnv('NODE_ENV', 'development');

    expect(magicLinkBindingCookieName()).toBe(DEV_COOKIE);
  });

  it('ignores a binding under the bare name in production', () => {
    vi.stubEnv('NODE_ENV', 'production');
    const binding = magicLinkBindingFor(TOKEN);

    expect(
      isBoundToThisBrowser(
        request({ cookies: { [DEV_COOKIE]: binding } }),
        TOKEN
      )
    ).toBe(false);
    expect(
      isBoundToThisBrowser(
        request({ cookies: { [PROD_COOKIE]: binding } }),
        TOKEN
      )
    ).toBe(true);
  });
});

describe('rememberMagicLinkBinding', () => {
  it('sets an HttpOnly, SameSite=Lax cookie on / outside production', () => {
    const { res, cookie } = response();

    rememberMagicLinkBinding(request({}), res, TOKEN);

    expect(cookie).toHaveBeenCalledWith(
      DEV_COOKIE,
      magicLinkBindingFor(TOKEN),
      {
        httpOnly: true,
        sameSite: 'lax',
        secure: false,
        path: '/',
        maxAge: 15 * 60 * 1000,
      }
    );
  });

  it('sets a Secure __Host- cookie on / with no Domain in production', () => {
    vi.stubEnv('NODE_ENV', 'production');
    const { res, cookie } = response();

    rememberMagicLinkBinding(request({}), res, TOKEN);

    expect(cookie).toHaveBeenCalledWith(
      PROD_COOKIE,
      magicLinkBindingFor(TOKEN),
      {
        httpOnly: true,
        sameSite: 'lax',
        secure: true,
        path: '/',
        maxAge: 15 * 60 * 1000,
      }
    );
  });

  it('sets fresh random bytes of the same shape when no link was issued', () => {
    const earlier = magicLinkBindingFor(TOKEN);
    const { res, cookie } = response();

    rememberMagicLinkBinding(
      request({ cookies: { [DEV_COOKIE]: earlier } }),
      res,
      undefined
    );

    expect(cookie).toHaveBeenCalledTimes(1);
    expect(cookie.mock.calls[0][0]).toBe(DEV_COOKIE);
    expect(cookie.mock.calls[0][1]).toMatch(/^[0-9a-f]{64}$/);
    expect(cookie.mock.calls[0][1]).not.toBe(earlier);
  });

  it.each(['cross-site', 'same-site'])(
    'sets nothing for a %s request',
    (site) => {
      const { res, cookie } = response();

      rememberMagicLinkBinding(
        request({ headers: { 'sec-fetch-site': site } }),
        res,
        TOKEN
      );

      expect(cookie).not.toHaveBeenCalled();
    }
  );
});

describe('isPrefetchRequest', () => {
  it.each([
    ['HEAD', {}],
    ['GET', { purpose: 'prefetch' }],
    ['GET', { 'sec-purpose': 'prefetch' }],
    ['GET', { 'sec-purpose': 'prefetch;prerender' }],
    ['GET', { 'x-moz': 'prefetch' }],
  ])('recognises %s with %o', (method, headers) => {
    expect(isPrefetchRequest(request({ method, headers }))).toBe(true);
  });

  it('lets an ordinary GET through', () => {
    expect(
      isPrefetchRequest(request({ headers: { 'sec-fetch-mode': 'cors' } }))
    ).toBe(false);
  });
});

describe('isSameOriginJsonRequest', () => {
  it.each([
    ['a same-origin JSON request', true, { 'sec-fetch-site': 'same-origin' }],
    ['a JSON request without fetch metadata', true, {}],
  ])('accepts %s', (_label, json, headers) => {
    expect(isSameOriginJsonRequest(request({ json, headers }))).toBe(true);
  });

  it.each([
    ['a form post', false, {}],
    ['a cross-site JSON request', true, { 'sec-fetch-site': 'cross-site' }],
    ['a same-site JSON request', true, { 'sec-fetch-site': 'same-site' }],
    ['a user-initiated navigation', true, { 'sec-fetch-site': 'none' }],
  ])('refuses %s', (_label, json, headers) => {
    expect(isSameOriginJsonRequest(request({ json, headers }))).toBe(false);
  });
});
