import { useQuery } from '@tanstack/react-query';
import { getAiCredits, AiCreditsResponse } from '../backend/getAiCredits';
import { useUserLocals } from './useUserLocals';

export const AI_CREDITS_QUERY_KEY = ['aiCredits'] as const;

export type AiCreditsState = AiCreditsResponse;

// The balance, and whether the read has finished: a finished read with no
// balance (a failed fetch, or no plan) is not the same as one still loading.
export interface AiCreditsRead {
  credits: AiCreditsState | null;
  settled: boolean;
}

const useAiCreditsQuery = (enabled: boolean) => {
  // The balance belongs to the signed-in account, so it is cached per
  // account: a page whose session changes account never shows the last
  // account's credits. Spend sites invalidate AI_CREDITS_QUERY_KEY, which
  // still matches every account's entry.
  const { data: userLocals } = useUserLocals();
  return useQuery({
    queryKey: [...AI_CREDITS_QUERY_KEY, userLocals?.user?.id ?? null],
    queryFn: getAiCredits,
    enabled,
    // The sidebar keeps this query mounted on every logged-in page, so a
    // refetch-on-focus default would hit the endpoint on every window
    // refocus. Spend sites invalidate this key directly after a spend, so
    // staleness here doesn't delay a post-spend update.
    staleTime: 30_000,
  });
};

export const useAiCredits = (enabled: boolean): AiCreditsState | null => {
  const { data } = useAiCreditsQuery(enabled);

  // No synthesized zero balance: while fetching, on a failed fetch, or for a
  // user with no plan, getAiCredits resolves null and the readout renders
  // nothing rather than claiming "0 AI credits left".
  if (!enabled || data == null) {
    return null;
  }

  return data;
};

export const useAiCreditsRead = (enabled: boolean): AiCreditsRead => {
  const { data, status } = useAiCreditsQuery(enabled);
  if (!enabled) {
    return { credits: null, settled: false };
  }
  return { credits: data ?? null, settled: status !== 'pending' };
};
