import { vi } from 'vitest';
import type { Request, Response } from 'express';

import {
  MCP_LOGIN_RETURN_COOKIE,
  MCP_LOGIN_RETURN_MAX_AGE_MS,
  asMcpAuthorizeReturn,
  rememberMcpLoginReturn,
  takeMcpLoginReturn,
} from './loginReturn';

const AUTHORIZE_URL =
  '/mcp/authorize?response_type=code&client_id=c1&redirect_uri=https%3A%2F%2Fchatgpt.com%2Fconnector%2Foauth%2Fcb&state=s1&code_challenge=abc&code_challenge_method=S256';

function fakeRes() {
  return {
    cookie: vi.fn(),
    clearCookie: vi.fn(),
  } as unknown as Response & {
    cookie: ReturnType<typeof vi.fn>;
    clearCookie: ReturnType<typeof vi.fn>;
  };
}

describe('asMcpAuthorizeReturn', () => {
  it.each([
    ['/mcp/authorize', '/mcp/authorize'],
    [AUTHORIZE_URL, AUTHORIZE_URL],
    [
      '/mcp/authorize?redirect_uri=https://chatgpt.com/cb&state=s1',
      '/mcp/authorize?redirect_uri=https://chatgpt.com/cb&state=s1',
    ],
  ])('keeps the full authorize path %s', (input, expected) => {
    expect(asMcpAuthorizeReturn(input)).toBe(expected);
  });

  it.each([
    '//evil.com',
    '//evil.com/mcp/authorize',
    '/\\evil.com',
    '/mcp/authorize\\@evil.com',
    'https://evil.com/mcp/authorize?client_id=c1',
    'mcp/authorize?client_id=c1',
    '/mcp/authorizeX',
    '/mcp/authorize/../../upload',
    '/mcp/authorize#frag',
    '/mcp/authorize? x',
    '/upload',
    '',
  ])('rejects %s', (input) => {
    expect(asMcpAuthorizeReturn(input)).toBeUndefined();
  });

  it.each([undefined, null, 42, ['/mcp/authorize'], { a: 1 }])(
    'rejects a non-string %s',
    (input) => {
      expect(asMcpAuthorizeReturn(input)).toBeUndefined();
    }
  );
});

describe('rememberMcpLoginReturn', () => {
  it('sets a short-lived httpOnly, Secure cookie holding the authorize URL', () => {
    const res = fakeRes();

    rememberMcpLoginReturn(res, AUTHORIZE_URL);

    expect(res.cookie).toHaveBeenCalledWith(
      MCP_LOGIN_RETURN_COOKIE,
      AUTHORIZE_URL,
      {
        httpOnly: true,
        secure: true,
        sameSite: 'none',
        path: '/',
        maxAge: MCP_LOGIN_RETURN_MAX_AGE_MS,
      }
    );
    expect(MCP_LOGIN_RETURN_MAX_AGE_MS).toBe(10 * 60 * 1000);
  });

  it.each(['//evil.com', '/upload', 'https://evil.com/mcp/authorize'])(
    'does not remember %s',
    (input) => {
      const res = fakeRes();

      rememberMcpLoginReturn(res, input);

      expect(res.cookie).not.toHaveBeenCalled();
    }
  );

  it('does not remember an authorize URL too long to fit in a cookie', () => {
    const res = fakeRes();

    rememberMcpLoginReturn(res, `/mcp/authorize?state=${'a'.repeat(3000)}`);

    expect(res.cookie).not.toHaveBeenCalled();
  });
});

describe('takeMcpLoginReturn', () => {
  it('returns the remembered authorize URL and clears the cookie', () => {
    const res = fakeRes();
    const req = {
      cookies: { [MCP_LOGIN_RETURN_COOKIE]: AUTHORIZE_URL },
    } as unknown as Request;

    expect(takeMcpLoginReturn(req, res)).toBe(AUTHORIZE_URL);
    expect(res.clearCookie).toHaveBeenCalledWith(MCP_LOGIN_RETURN_COOKIE, {
      httpOnly: true,
      secure: true,
      sameSite: 'none',
      path: '/',
    });
  });

  it('clears a tampered cookie and returns nothing', () => {
    const res = fakeRes();
    const req = {
      cookies: { [MCP_LOGIN_RETURN_COOKIE]: '//evil.com' },
    } as unknown as Request;

    expect(takeMcpLoginReturn(req, res)).toBeUndefined();
    expect(res.clearCookie).toHaveBeenCalledTimes(1);
  });

  it('leaves the response alone when no cookie is present', () => {
    const res = fakeRes();

    expect(takeMcpLoginReturn({} as Request, res)).toBeUndefined();
    expect(res.clearCookie).not.toHaveBeenCalled();
  });
});
