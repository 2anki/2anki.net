import { describe, it, expect, vi } from 'vitest';
import geoip from 'geoip-lite';
import { consentRegionFor, consentRegionForRequest } from './consentRegion';

vi.mock('geoip-lite', () => ({ default: { lookup: vi.fn() } }));
vi.mock('../rateLimit/ipHelpers', () => ({
  resolveClientIp: () => '203.0.113.9',
}));

describe('consentRegionFor', () => {
  it.each(['DE', 'de', 'FR', 'NO', 'IS', 'GB', 'CH', 'IE'])(
    'requires consent in %s',
    (country) => {
      expect(consentRegionFor(country)).toBe('eea');
    }
  );

  it.each(['US', 'CA', 'AU', 'BR', 'IN', 'JP'])(
    'does not require consent in %s',
    (country) => {
      expect(consentRegionFor(country)).toBe('other');
    }
  );

  it('falls back to requiring consent when the country is unknown', () => {
    expect(consentRegionFor(null)).toBe('eea');
    expect(consentRegionFor('')).toBe('eea');
  });
});

describe('consentRegionForRequest', () => {
  it('uses the geo lookup of the client ip and ignores spoofable country headers', () => {
    vi.mocked(geoip.lookup).mockReturnValue({ country: 'DE' } as never);
    const req = {
      headers: { 'cf-ipcountry': 'US', 'cloudfront-viewer-country': 'US' },
    } as never;

    expect(consentRegionForRequest(req)).toBe('eea');
  });

  it('falls back to eea when the ip is unknown to the geo database', () => {
    vi.mocked(geoip.lookup).mockReturnValue(null);

    expect(consentRegionForRequest({ headers: {} } as never)).toBe('eea');
  });
});
