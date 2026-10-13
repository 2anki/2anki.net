import type { Stripe as StripeTypes } from 'stripe/cjs/stripe.core';
import { formatDisplay } from './GetPassPricingUseCase';

export interface AutoSyncPriceView {
  amount: number;
  currency: string;
  interval: string;
  display: string;
}

const CACHE_MS = 10 * 60 * 1000;

export class GetAutoSyncPriceUseCase {
  private cached: { view: AutoSyncPriceView | null; at: number } | null = null;

  constructor(
    private readonly stripe: Pick<StripeTypes, 'prices'>,
    private readonly priceId: string
  ) {}

  async execute(): Promise<AutoSyncPriceView | null> {
    if (this.priceId === '') return null;
    if (this.cached != null && Date.now() - this.cached.at < CACHE_MS) {
      return this.cached.view;
    }
    const view = await this.lookup();
    this.cached = { view, at: Date.now() };
    return view;
  }

  private async lookup(): Promise<AutoSyncPriceView | null> {
    try {
      const price = await this.stripe.prices.retrieve(this.priceId);
      if (
        !price.active ||
        price.unit_amount == null ||
        price.recurring == null
      ) {
        return null;
      }
      return {
        amount: price.unit_amount,
        currency: price.currency,
        interval: price.recurring.interval,
        display: formatDisplay(price.unit_amount, price.currency),
      };
    } catch (error) {
      console.error('auto_sync.price.resolve_failed', {
        message: error instanceof Error ? error.message : 'unknown',
      });
      return null;
    }
  }
}
