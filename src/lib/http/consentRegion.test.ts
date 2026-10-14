import { describe, it, expect } from 'vitest';
import { consentRegionFor } from './consentRegion';

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
