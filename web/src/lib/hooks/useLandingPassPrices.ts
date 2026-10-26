import { useQuery } from '@tanstack/react-query';
import { getLandingConfig } from '../backend/getLandingConfig';

const FIVE_MINUTES_MS = 5 * 60 * 1000;

export function useLandingPassPricesEnabled(): boolean {
  const { data } = useQuery({
    queryKey: ['landingConfig'],
    queryFn: getLandingConfig,
    staleTime: FIVE_MINUTES_MS,
    retry: false,
  });

  return data?.showPassPrices ?? false;
}
