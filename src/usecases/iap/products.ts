import type { PassKind } from '../../data_layer/UserPassRepository';
import {
  CREDIT_PACK_CREDITS,
  CREDIT_PACK_EXPIRY_DAYS,
} from '../checkout/creditPack';

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

export interface CreditsProduct {
  kind: 'credits';
  productId: string;
  credits: number;
  expiryDays: number;
  successMessage: string;
}

export type AppleProduct =
  | ConsumableProduct
  | SubscriptionProduct
  | CreditsProduct;

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
      'Pro active — no card limit, PDF uploads, and several conversions at once',
  },
  // Mirrors the $5 web pack sold through Stripe Checkout: same credits, same
  // 90-day expiry, same grant ledger.
  'aicredits.250': {
    kind: 'credits',
    productId: 'aicredits.250',
    credits: CREDIT_PACK_CREDITS,
    expiryDays: CREDIT_PACK_EXPIRY_DAYS,
    successMessage: `${CREDIT_PACK_CREDITS} AI credits added — they last ${CREDIT_PACK_EXPIRY_DAYS} days`,
  },
};

export function findAppleProduct(productId: string): AppleProduct | null {
  return APPLE_PRODUCTS[productId] ?? null;
}
