import { useQuery } from '@tanstack/react-query';
import { getLandingConfig } from '../backend/getLandingConfig';

const FIVE_MINUTES_MS = 5 * 60 * 1000;

function useLandingConfigQuery() {
  return useQuery({
    queryKey: ['landingConfig'],
    queryFn: getLandingConfig,
    staleTime: FIVE_MINUTES_MS,
    retry: false,
  });
}

export function useLandingPassPricesEnabled(): boolean {
  return useLandingConfigQuery().data?.showPassPrices ?? false;
}

export function useLandingPassPricesPending(): boolean {
  return useLandingConfigQuery().isPending;
}
