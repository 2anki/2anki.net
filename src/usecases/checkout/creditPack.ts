export const CREDIT_PACK_CREDITS = 250;
export const CREDIT_PACK_PRICE_CENTS = 500;
export const CREDIT_PACK_EXPIRY_DAYS = 90;

const CREDIT_PACK_SOURCES = [
  'credits_conversion',
  'credits_badge',
  'credits_account',
] as const;

export type CreditPackSource = (typeof CREDIT_PACK_SOURCES)[number];

export function parseCreditPackSource(
  value: unknown
): CreditPackSource | undefined {
  return CREDIT_PACK_SOURCES.includes(value as CreditPackSource)
    ? (value as CreditPackSource)
    : undefined;
}

export interface CreditPackRedirect {
  successUrl: string;
  cancelUrl: string;
}

const SOURCE_PATHS: Record<CreditPackSource, string> = {
  credits_conversion: '/upload',
  credits_badge: '/upload',
  credits_account: '/account',
};

export function resolveCreditPackRedirect(
  source: CreditPackSource | undefined,
  appUrl: string
): CreditPackRedirect {
  const path = source == null ? '/upload' : SOURCE_PATHS[source];
  return {
    successUrl: `${appUrl}${path}?credits=added`,
    cancelUrl: `${appUrl}${path}`,
  };
}
