import type StripeTypes from 'stripe';

const resolvedPriceIdCache = new Map<string, string>();

export const clearResolvedPriceIdCache = (): void => {
  resolvedPriceIdCache.clear();
};

export class StripePriceResolver {
  constructor(private readonly stripe: Pick<StripeTypes, 'prices'>) {}

  async resolveByLookupKey(lookupKey: string): Promise<string | null> {
    const cached = resolvedPriceIdCache.get(lookupKey);
    if (cached != null) return cached;

    try {
      const result = await this.stripe.prices.list({
        lookup_keys: [lookupKey],
        active: true,
        limit: 1,
      });
      const priceId = result.data[0]?.id;
      if (priceId == null) {
        console.warn('pricing.resolve.miss', { lookup_key: lookupKey });
        return null;
      }
      resolvedPriceIdCache.set(lookupKey, priceId);
      return priceId;
    } catch (error) {
      console.error('pricing.resolve.failed', {
        lookup_key: lookupKey,
        message: error instanceof Error ? error.message : 'unknown',
      });
      return null;
    }
  }
}
