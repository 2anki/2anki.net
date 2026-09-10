import type { PassKind } from '../../data_layer/UserPassRepository';

export interface ConsumableProduct {
  kind: 'consumable';
  productId: string;
  passKind: Extract<PassKind, '24h' | '7d' | '120d'>;
  durationMs: number;
  successMessage: string;
}

export interface SubscriptionProduct {
  kind: 'subscription';
  productId: string;
  passKind: Extract<PassKind, 'unlimited'>;
  successMessage: string;
}

export type AppleProduct = ConsumableProduct | SubscriptionProduct;

const DAY_MS = 24 * 60 * 60 * 1000;

export const APPLE_PRODUCTS: Record<string, AppleProduct> = {
  'daypass.24h': {
    kind: 'consumable',
    productId: 'daypass.24h',
    passKind: '24h',
    durationMs: DAY_MS,
    successMessage: 'Day Pass active — unlimited cards for the next 24 hours',
  },
  'weekpass.7d': {
    kind: 'consumable',
    productId: 'weekpass.7d',
    passKind: '7d',
    durationMs: 7 * DAY_MS,
    successMessage: 'Week Pass active — unlimited cards for the next 7 days',
  },
  'semesterpass.120d': {
    kind: 'consumable',
    productId: 'semesterpass.120d',
    passKind: '120d',
    durationMs: 120 * DAY_MS,
    successMessage:
      'Semester Pass active — unlimited cards for the next 120 days',
  },
  'unlimited.monthly': {
    kind: 'subscription',
    productId: 'unlimited.monthly',
    passKind: 'unlimited',
    successMessage:
      'Unlimited active — no card limit, PDF uploads, and several conversions at once',
  },
};

export function findAppleProduct(productId: string): AppleProduct | null {
  return APPLE_PRODUCTS[productId] ?? null;
}
