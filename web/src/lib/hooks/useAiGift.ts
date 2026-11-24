import { useQuery } from '@tanstack/react-query';
import { getAiGift, type AiGiftStatus } from '../backend/aiGift';
import { useUserLocals } from './useUserLocals';

export const AI_GIFT_QUERY_KEY = ['aiGift'] as const;

export function useAiGift(): AiGiftStatus | null {
  const { data: userLocals, isLoading } = useUserLocals();
  const { data } = useQuery({
    queryKey: [...AI_GIFT_QUERY_KEY, userLocals?.user?.id ?? null],
    queryFn: getAiGift,
    enabled: !isLoading,
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });
  return data ?? null;
}
