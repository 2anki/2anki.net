import { useQuery } from '@tanstack/react-query';
import { getCardUsage, CardUsageResponse } from '../backend/getCardUsage';
import { useUserLocals } from './useUserLocals';

export const CARD_USAGE_QUERY_KEY = ['cardUsage'] as const;

interface CardUsageState extends CardUsageResponse {
  loading: boolean;
}

export const useCardUsage = (enabled: boolean): CardUsageState | null => {
  const { data: userLocals } = useUserLocals();
  const { data, isFetching } = useQuery({
    queryKey: [...CARD_USAGE_QUERY_KEY, userLocals?.user?.id ?? null],
    queryFn: getCardUsage,
    enabled,
  });

  if (!enabled) {
    return null;
  }

  if (data == null) {
    return {
      cards_used: 0,
      cards_limit: 100,
      unlimited: false,
      loading: isFetching,
    };
  }

  return { ...data, loading: false };
};
