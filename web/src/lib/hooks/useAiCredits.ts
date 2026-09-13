import { useQuery } from '@tanstack/react-query';
import { getAiCredits, AiCreditsResponse } from '../backend/getAiCredits';

export const AI_CREDITS_QUERY_KEY = ['aiCredits'] as const;

export interface AiCreditsState extends AiCreditsResponse {
  loading: boolean;
}

export const useAiCredits = (enabled: boolean): AiCreditsState | null => {
  const { data, isFetching } = useQuery({
    queryKey: AI_CREDITS_QUERY_KEY,
    queryFn: getAiCredits,
    enabled,
  });

  if (!enabled) {
    return null;
  }

  if (data == null) {
    return {
      credits: 0,
      allowance: 0,
      windowEnd: null,
      resets: 'period',
      loading: isFetching,
    };
  }

  return { ...data, loading: false };
};
