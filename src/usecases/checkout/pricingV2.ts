export const PRICING_COHORT = 'v2';

export type PricingCohort = typeof PRICING_COHORT;

export const V2_MONTHLY_LOOKUP_KEY = 'v2_monthly';
export const V2_ANNUAL_LOOKUP_KEY = 'v2_annual';

export const V2_PRICE_CENTS = {
  monthly: 799,
  annual: 6400,
} as const;
