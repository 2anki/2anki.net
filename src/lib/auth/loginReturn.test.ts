import { vi } from 'vitest';
import type { Request, Response } from 'express';

import {
  LOGIN_RETURN_COOKIE,
  LOGIN_RETURN_MAX_AGE_MS,
  asLoginReturn,
  logLoginReturnUsed,
  rememberLoginReturn,
  takeLoginReturn,
} from './loginReturn';

function fakeRes() {
  return {
    cookie: vi.fn(),
    clearCookie: vi.fn(),
  } as unknown as Response & {
    cookie: ReturnType<typeof vi.fn>;
    clearCookie: ReturnType<typeof vi.fn>;
  };
}

function loginRequest(
  redirect: unknown,
  cookies: Record<string, unknown> = {}
): Request {
  return { query: { redirect }, cookies } as unknown as Request;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('asLoginReturn', () => {
  it.each([
    ['/pricing?ref=mcp', '/pricing?ref=mcp'],
    ['/pricing/?ref=mcp#auto-sync', '/pricing?ref=mcp#auto-sync'],
    ['/pricing?ref=mcp&utm=x', '/pricing?ref=mcp'],
    ['/upload', '/upload'],
    ['/notion/some-page', '/notion'],
    ['/api/download/u/abc123', '/api/download/u/abc123'],
  ])('keeps %s as a same-origin path (%s)', (input, expected) => {
    expect(asLoginReturn(input)).toBe(expected);
  });

  it.each([
    'https://evil.com/pricing',
    '//evil.com',
    '//evil.com/pricing',
    '/\\evil.com',
    'javascript:alert(1)',
    'https://2anki.net/pricing',
    '/not-a-section',
    '/api/download/u/../../etc',
    '',
    `/pricing?ref=${'a'.repeat(3000)}`,
    '/mcp/authorize?client_id=c1&state=s1',
    `/mcp/authorize?state=${'界'.repeat(1000)}`,
  ])('refuses %s', (input) => {
    expect(asLoginReturn(input)).toBeUndefined();
  });

  it.each([undefined, null, 42, ['/pricing'], { a: 1 }])(
    'refuses a non-string %s',
    (input) => {
      expect(asLoginReturn(input)).toBeUndefined();
    }
  );
});

describe('rememberLoginReturn', () => {
  it('sets a short-lived httpOnly, Secure cookie that the Apple form POST still carries', () => {
    const res = fakeRes();

    rememberLoginReturn(loginRequest('/pricing?ref=mcp'), res);

    expect(res.cookie).toHaveBeenCalledWith(
      LOGIN_RETURN_COOKIE,
      '/pricing?ref=mcp',
      {
        httpOnly: true,
        secure: true,
        sameSite: 'none',
        path: '/',
        maxAge: LOGIN_RETURN_MAX_AGE_MS,
      }
    );
    expect(LOGIN_RETURN_MAX_AGE_MS).toBe(10 * 60 * 1000);
  });

  it.each(['https://evil.com', '//evil.com', '/\\evil.com', ['/pricing'], 7])(
    'never sets the cookie for %s',
    (redirect) => {
      const res = fakeRes();

      rememberLoginReturn(loginRequest(redirect), res);

      expect(res.cookie).not.toHaveBeenCalled();
    }
  );

  it.each([
    [{ error: 'google_signin_failed' }],
    [{ error: 'notion_cancelled' }],
    [{}],
    [{ redirect: '//evil.com' }],
  ])(
    'keeps an earlier cookie when /login opens with %o, so a retried or cancelled sign-in still lands',
    (query) => {
      const res = fakeRes();

      rememberLoginReturn(
        {
          query,
          cookies: { [LOGIN_RETURN_COOKIE]: '/pricing?ref=mcp' },
        } as unknown as Request,
        res
      );

      expect(res.cookie).not.toHaveBeenCalled();
      expect(res.clearCookie).not.toHaveBeenCalled();
    }
  );

  it('leaves the response alone when there is no redirect and no cookie', () => {
    const res = fakeRes();

    rememberLoginReturn(loginRequest(undefined), res);

    expect(res.cookie).not.toHaveBeenCalled();
    expect(res.clearCookie).not.toHaveBeenCalled();
  });
});

describe('logLoginReturnUsed', () => {
  it('logs the sign-in method and the section, never the full path', () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => {});

    logLoginReturnUsed('/api/download/u/secret-key', 'google');

    expect(info).toHaveBeenCalledWith(
      '[login-return] used via=google section=api'
    );
    expect(JSON.stringify(info.mock.calls)).not.toContain('secret-key');
    info.mockRestore();
  });
});

describe('takeLoginReturn', () => {
  it('returns the remembered path and clears the cookie', () => {
    const res = fakeRes();

    expect(
      takeLoginReturn(
        loginRequest(undefined, { [LOGIN_RETURN_COOKIE]: '/pricing?ref=mcp' }),
        res
      )
    ).toBe('/pricing?ref=mcp');
    expect(res.clearCookie).toHaveBeenCalledWith(
      LOGIN_RETURN_COOKIE,
      expect.objectContaining({ path: '/' })
    );
  });

  it('does not log by itself, since another return may still win', () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => {});

    takeLoginReturn(
      loginRequest(undefined, { [LOGIN_RETURN_COOKIE]: '/pricing' }),
      fakeRes()
    );

    expect(info).not.toHaveBeenCalled();
    info.mockRestore();
  });

  it.each(['//evil.com', 'https://evil.com/pricing', '/\\evil.com', 42])(
    'refuses a tampered cookie %s and still clears it',
    (value) => {
      const res = fakeRes();

      expect(
        takeLoginReturn(
          loginRequest(undefined, { [LOGIN_RETURN_COOKIE]: value }),
          res
        )
      ).toBeUndefined();
      expect(res.clearCookie).toHaveBeenCalledWith(
        LOGIN_RETURN_COOKIE,
        expect.anything()
      );
    }
  );

  it('returns nothing and leaves the response alone without a cookie', () => {
    const res = fakeRes();

    expect(takeLoginReturn({} as Request, res)).toBeUndefined();
    expect(res.clearCookie).not.toHaveBeenCalled();
  });
});
