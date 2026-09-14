import { computeUsageCostUsd, resolveModelPricing } from './pricing';

describe('resolveModelPricing', () => {
  it('matches dated model ids by prefix', () => {
    expect(resolveModelPricing('claude-haiku-4-5-20251001')).toEqual({
      inputPerMillion: 1,
      outputPerMillion: 5,
    });
  });

  it('prices sonnet 5 and sonnet 4.5 at the same sticker', () => {
    expect(resolveModelPricing('claude-sonnet-5')).toEqual(
      resolveModelPricing('claude-sonnet-4-5')
    );
  });

  it('falls back to sonnet rates for unknown models', () => {
    expect(resolveModelPricing('claude-opus-9')).toEqual({
      inputPerMillion: 3,
      outputPerMillion: 15,
    });
    expect(resolveModelPricing(undefined)).toEqual({
      inputPerMillion: 3,
      outputPerMillion: 15,
    });
  });
});

describe('computeUsageCostUsd', () => {
  it('prices input, output, and cache tokens at sonnet rates', () => {
    const cost = computeUsageCostUsd('claude-sonnet-5', {
      input_tokens: 1_000_000,
      output_tokens: 1_000_000,
      cache_creation_input_tokens: 1_000_000,
      cache_read_input_tokens: 1_000_000,
    });
    expect(cost).toBe(3 + 15 + 3 * 1.25 + 3 * 0.1);
  });

  it('prices the haiku tagging path at haiku rates', () => {
    const cost = computeUsageCostUsd('claude-haiku-4-5-20251001', {
      input_tokens: 2_000_000,
      output_tokens: 1_000_000,
    });
    expect(cost).toBe(2 + 5);
  });

  it('returns 0 when usage is missing', () => {
    expect(computeUsageCostUsd('claude-sonnet-5', null)).toBe(0);
    expect(computeUsageCostUsd('claude-sonnet-5', {})).toBe(0);
  });

  it('rounds to four decimal places', () => {
    const cost = computeUsageCostUsd('claude-sonnet-5', {
      input_tokens: 1234,
      output_tokens: 567,
    });
    expect(cost).toBe(0.0122);
  });
});
