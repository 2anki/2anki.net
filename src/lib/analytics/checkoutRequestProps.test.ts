import { describe, it, expect, vi, beforeEach } from 'vitest';
import geoip from 'geoip-lite';
import { checkoutRequestProps } from './checkoutRequestProps';

vi.mock('geoip-lite', () => ({ default: { lookup: vi.fn() } }));

const request = (overrides: Record<string, unknown> = {}) =>
  ({ ip: '203.0.113.9', cookies: {}, headers: {}, ...overrides }) as never;

describe('checkoutRequestProps', () => {
  beforeEach(() => {
    vi.mocked(geoip.lookup).mockReset();
  });

  it('returns only the country and the device class', () => {
    vi.mocked(geoip.lookup).mockReturnValue({ country: 'US' } as never);

    expect(
      checkoutRequestProps(
        request({
          headers: { 'user-agent': 'Mozilla/5.0 (iPad; CPU OS 18_0)' },
        })
      )
    ).toEqual({ country: 'US', device: 'tablet' });
  });

  it('records an unknown device and no country when neither can be read', () => {
    vi.mocked(geoip.lookup).mockReturnValue(null);

    expect(
      checkoutRequestProps(request({ cookies: { cookie_consent: 'granted' } }))
    ).toEqual({ country: null, device: 'unknown' });
  });
});
