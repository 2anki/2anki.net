export type PricingOrder =
  | 'passes-first'
  | 'unlimited-first'
  | 'minimal'
  | 'semester-first';

export const VARIANTS: PricingOrder[] = [
  'passes-first',
  'unlimited-first',
  'minimal',
  'semester-first',
];

export function usePricingOrderVariant(): PricingOrder {
  return 'semester-first';
}
