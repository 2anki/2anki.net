import type { Stripe as StripeTypes } from 'stripe/cjs/stripe.core';

export type PassPriceKind = '24h' | '7d' | '120d';

export const PASS_PRICE_KINDS: readonly PassPriceKind[] = ['24h', '7d', '120d'];

export type PassPriceSource = 'stripe' | 'cache' | 'env' | 'none';

export interface ResolvedPassPrice {
  kind: PassPriceKind;
  priceId: string | null;
  amount: number | null;
  currency: string | null;
  source: PassPriceSource;
}

const PASS_KIND_METADATA_KEY = '2anki_pass_kind';
const CACHE_TTL_MS = 5 * 60 * 1000;
const SEARCH_LIMIT = 100;

const ENV_PRICE_ID_BY_KIND: Record<PassPriceKind, string> = {
  '24h': 'PASS_24H_PRICE_ID',
  '7d': 'PASS_7D_PRICE_ID',
  '120d': 'PASS_120D_PRICE_ID',
};

const envPriceId = (kind: PassPriceKind): string =>
  process.env[ENV_PRICE_ID_BY_KIND[kind]] ?? '';

interface CacheEntry {
  record: ResolvedPassPrice;
  expiresAt: number;
}

export class PricingService {
  private readonly cache = new Map<PassPriceKind, CacheEntry>();
  private readonly lastKnownGood = new Map<PassPriceKind, ResolvedPassPrice>();

  constructor(private readonly stripe: Pick<StripeTypes, 'prices'>) {}

  async resolve(kind: PassPriceKind): Promise<ResolvedPassPrice> {
    const cached = this.cache.get(kind);
    if (cached != null && cached.expiresAt > Date.now()) {
      return cached.record;
    }

    const fresh = await this.resolveFromStripe(kind);
    if (fresh != null) {
      this.cache.set(kind, {
        record: fresh,
        expiresAt: Date.now() + CACHE_TTL_MS,
      });
      this.lastKnownGood.set(kind, fresh);
      return fresh;
    }

    return this.fallback(kind);
  }

  async resolvePriceId(kind: PassPriceKind): Promise<string | null> {
    return (await this.resolve(kind)).priceId;
  }

  async resolveAll(): Promise<ResolvedPassPrice[]> {
    return Promise.all(PASS_PRICE_KINDS.map((kind) => this.resolve(kind)));
  }

  private async resolveFromStripe(
    kind: PassPriceKind
  ): Promise<ResolvedPassPrice | null> {
    try {
      const result = await this.stripe.prices.search({
        query: `metadata['${PASS_KIND_METADATA_KEY}']:'${kind}' AND active:'true'`,
        limit: SEARCH_LIMIT,
      });
      const prices = result.data ?? [];
      if (prices.length === 0) {
        console.warn('pricing.pass.miss', { kind });
        return null;
      }
      if (prices.length > 1) {
        console.warn('pricing.pass.multiple_active', {
          kind,
          count: prices.length,
        });
      }
      const chosen = prices.reduce((newest, current) =>
        current.created > newest.created ? current : newest
      );
      return {
        kind,
        priceId: chosen.id,
        amount: chosen.unit_amount,
        currency: chosen.currency,
        source: 'stripe',
      };
    } catch (error) {
      console.error('pricing.pass.resolve_failed', {
        kind,
        message: error instanceof Error ? error.message : 'unknown',
      });
      return null;
    }
  }

  private fallback(kind: PassPriceKind): ResolvedPassPrice {
    const known = this.lastKnownGood.get(kind);
    if (known != null) {
      return { ...known, source: 'cache' };
    }

    const fallbackPriceId = envPriceId(kind);
    if (fallbackPriceId !== '') {
      return {
        kind,
        priceId: fallbackPriceId,
        amount: null,
        currency: null,
        source: 'env',
      };
    }

    return {
      kind,
      priceId: null,
      amount: null,
      currency: null,
      source: 'none',
    };
  }
}
