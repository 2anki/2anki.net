import { vi } from 'vitest';
import express from 'express';
import geoip from 'geoip-lite';
import { mcpFirstTouchMiddleware } from './mcpFirstTouch';

vi.mock('geoip-lite', () => ({ default: { lookup: vi.fn() } }));

function run(cookies: Record<string, unknown> | undefined) {
  const req = { cookies, headers: {} } as unknown as express.Request;
  const cookieMock = vi.fn();
  const res = { cookie: cookieMock } as unknown as express.Response;
  const next = vi.fn();
  mcpFirstTouchMiddleware(req, res, next);
  return { cookieMock, next };
}

describe('mcpFirstTouchMiddleware', () => {
  it('sets a first-touch cookie with the /mcp landing path when absent and allowed', () => {
    const { cookieMock, next } = run({ cookie_consent: 'granted' });

    expect(cookieMock).toHaveBeenCalledWith(
      'first_touch',
      JSON.stringify({ landingPath: '/mcp', referrer: '' }),
      { maxAge: 30 * 60 * 1000, path: '/', sameSite: 'lax' }
    );
    expect(next).toHaveBeenCalled();
  });

  it('never overwrites an existing first touch', () => {
    const { cookieMock, next } = run({
      cookie_consent: 'granted',
      first_touch: JSON.stringify({ landingPath: '/pricing', referrer: '' }),
    });

    expect(cookieMock).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalled();
  });

  it('sets nothing after Only necessary, or in the EEA before a choice', () => {
    vi.mocked(geoip.lookup).mockReturnValue(null);
    expect(run({ cookie_consent: 'denied' }).cookieMock).not.toHaveBeenCalled();
    expect(run(undefined).cookieMock).not.toHaveBeenCalled();
  });

  it('sets the cookie outside the EEA when no choice is stored', () => {
    vi.mocked(geoip.lookup).mockReturnValue({ country: 'US' } as never);
    expect(run(undefined).cookieMock).toHaveBeenCalledTimes(1);
  });
});
