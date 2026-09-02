import { useQuery } from '@tanstack/react-query';
import { getPassPricing } from '../backend/getPassPricing';
import { FALLBACK_PASS_PRICES } from '../../pages/PricingPage/payment.links';

export type PassPriceDisplay = Record<'24h' | '7d' | '120d', string>;

const FIVE_MINUTES_MS = 5 * 60 * 1000;

export function usePassPrices(): PassPriceDisplay {
  const { data } = useQuery({
    queryKey: ['passPricing'],
    queryFn: getPassPricing,
    staleTime: FIVE_MINUTES_MS,
    retry: false,
  });

  return {
    '24h': data?.passes['24h']?.display ?? FALLBACK_PASS_PRICES['24h'],
    '7d': data?.passes['7d']?.display ?? FALLBACK_PASS_PRICES['7d'],
    '120d': data?.passes['120d']?.display ?? FALLBACK_PASS_PRICES['120d'],
  };
}
