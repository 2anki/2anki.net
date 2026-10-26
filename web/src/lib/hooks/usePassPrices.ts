import { useQuery } from '@tanstack/react-query';
import { getPassPricing } from '../backend/getPassPricing';
import { FALLBACK_PASS_PRICES } from '../../pages/PricingPage/payment.links';

export type PassPriceDisplay = Record<'24h' | '7d' | '120d', string>;
export type LivePassPrices = Partial<PassPriceDisplay>;

const FIVE_MINUTES_MS = 5 * 60 * 1000;

function usePassPricingQuery() {
  return useQuery({
    queryKey: ['passPricing'],
    queryFn: getPassPricing,
    staleTime: FIVE_MINUTES_MS,
    retry: false,
  });
}

export function usePassPrices(): PassPriceDisplay {
  const { data } = usePassPricingQuery();

  return {
    '24h': data?.passes['24h']?.display ?? FALLBACK_PASS_PRICES['24h'],
    '7d': data?.passes['7d']?.display ?? FALLBACK_PASS_PRICES['7d'],
    '120d': data?.passes['120d']?.display ?? FALLBACK_PASS_PRICES['120d'],
  };
}

export function useLivePassPrices(): LivePassPrices {
  const { data } = usePassPricingQuery();

  if (data == null) {
    return {};
  }

  return {
    '24h': data.passes['24h']?.display,
    '7d': data.passes['7d']?.display,
    '120d': data.passes['120d']?.display,
  };
}
