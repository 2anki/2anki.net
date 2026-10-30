import { useSearchParams } from 'react-router-dom';

export type PricingOrder =
  | 'passes-first'
  | 'unlimited-first'
  | 'minimal'
  | 'semester-first'
  | 'mcp-day-first';

export const VARIANTS: PricingOrder[] = [
  'passes-first',
  'unlimited-first',
  'minimal',
  'semester-first',
  'mcp-day-first',
];

export function usePricingOrderVariant(): PricingOrder {
  const [searchParams] = useSearchParams();
  return searchParams.get('ref')?.toLowerCase() === 'mcp'
    ? 'mcp-day-first'
    : 'semester-first';
}
