import express from 'express';
import { mcpFirstTouchMiddleware } from './mcpFirstTouch';

function run(cookies: Record<string, unknown> | undefined) {
  const req = { cookies } as unknown as express.Request;
  const cookieMock = jest.fn();
  const res = { cookie: cookieMock } as unknown as express.Response;
  const next = jest.fn();
  mcpFirstTouchMiddleware(req, res, next);
  return { cookieMock, next };
}

describe('mcpFirstTouchMiddleware', () => {
  it('sets a first-touch cookie with the /mcp landing path when absent', () => {
    const { cookieMock, next } = run(undefined);

    expect(cookieMock).toHaveBeenCalledWith(
      'first_touch',
      JSON.stringify({ landingPath: '/mcp', referrer: '' }),
      { maxAge: 30 * 60 * 1000, path: '/', sameSite: 'lax' }
    );
    expect(next).toHaveBeenCalled();
  });

  it('never overwrites an existing first touch', () => {
    const { cookieMock, next } = run({
      first_touch: JSON.stringify({ landingPath: '/pricing', referrer: '' }),
    });

    expect(cookieMock).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalled();
  });
});
