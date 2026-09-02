import { get } from './api';

export type PassPriceKind = '24h' | '7d' | '120d';

export interface PassPriceEntry {
  amount: number;
  currency: string;
  display: string;
}

export interface PassPricingResponse {
  passes: Partial<Record<PassPriceKind, PassPriceEntry>>;
}

export const getPassPricing = async (): Promise<PassPricingResponse> => {
  const data = await get('/api/pricing');
  if (data == null || typeof data.passes !== 'object') {
    return { passes: {} };
  }
  return data as PassPricingResponse;
};
