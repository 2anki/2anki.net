import { useQuery } from '@tanstack/react-query';
import { getAiCredits, AiCreditsResponse } from '../backend/getAiCredits';

export const AI_CREDITS_QUERY_KEY = ['aiCredits'] as const;

export type AiCreditsState = AiCreditsResponse;

export const useAiCredits = (enabled: boolean): AiCreditsState | null => {
  const { data } = useQuery({
    queryKey: AI_CREDITS_QUERY_KEY,
    queryFn: getAiCredits,
    enabled,
    // The sidebar keeps this query mounted on every logged-in page, so a
    // refetch-on-focus default would hit the endpoint on every window
    // refocus. Spend sites invalidate this key directly after a spend, so
    // staleness here doesn't delay a post-spend update.
    staleTime: 30_000,
  });

  // No synthesized zero balance: while fetching, on a failed fetch, or for a
  // user with no plan, getAiCredits resolves null and the readout renders
  // nothing rather than claiming "0 AI credits left".
  if (!enabled || data == null) {
    return null;
  }

  return data;
};
