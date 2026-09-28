import { parsePricingVariant } from './pricingVariant';

describe('parsePricingVariant', () => {
  it('accepts the known variant labels', () => {
    expect(parsePricingVariant('passes-first')).toBe('passes-first');
    expect(parsePricingVariant('unlimited-first')).toBe('unlimited-first');
    expect(parsePricingVariant('minimal')).toBe('minimal');
    expect(parsePricingVariant('semester-first')).toBe('semester-first');
  });

  it('rejects anything unknown so it never reaches Stripe metadata', () => {
    expect(parsePricingVariant('')).toBeUndefined();
    expect(parsePricingVariant('hacker')).toBeUndefined();
    expect(parsePricingVariant(undefined)).toBeUndefined();
    expect(parsePricingVariant(42)).toBeUndefined();
    expect(parsePricingVariant({ variant: 'minimal' })).toBeUndefined();
  });
});
