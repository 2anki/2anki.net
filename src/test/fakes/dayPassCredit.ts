import { vi } from 'vitest';
import type { HeldEntitlements } from '../../usecases/checkout/resolvePurchaseBlock';

export const nothingHeld = (
  over: Partial<HeldEntitlements> = {}
): HeldEntitlements => ({
  lifetime: false,
  activeSubscription: false,
  unprovenSubscription: false,
  billedThroughApple: false,
  activePassKind: null,
  activePassExpiresAt: null,
  semesterRenewalOpen: false,
  ...over,
});

export interface LivePrice {
  amount: number;
  currency?: string;
  product?: string;
}

export type LivePasses = Record<'24h' | '120d', LivePrice>;

export const stripePassPrices = (prices: LivePasses) => ({
  search: vi.fn(async ({ query }: { query: string }) => {
    const kind = (['24h', '120d'] as const).find((candidate) =>
      query.includes(`'${candidate}'`)
    );
    if (kind == null) {
      return { data: [] };
    }
    const live = prices[kind];
    return {
      data: [
        {
          id: `price_${kind}`,
          unit_amount: live.amount,
          currency: live.currency ?? 'usd',
          created: 1,
          product: live.product ?? `prod_${kind}`,
        },
      ],
    };
  }),
});
