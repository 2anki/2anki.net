import { useQuery } from '@tanstack/react-query';
import { getAiGift, type AiGiftStatus } from '../backend/aiGift';

export const AI_GIFT_QUERY_KEY = ['aiGift'] as const;

// Keyed by whether the caller is signed in, and deliberately not subscribed to
// the user locals query: the header mounts this as soon as the session is
// known, and a new locals observer on a failed read restarts that read, which
// unmounts and remounts the header in a loop.
export function useAiGift(signedIn: boolean): AiGiftStatus | null {
  const { data } = useQuery({
    queryKey: [...AI_GIFT_QUERY_KEY, signedIn],
    queryFn: getAiGift,
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });
  return data ?? null;
}

// The header's credits pill keeps this query fetched for a signed-in account
// on every page, so a reader below it follows that answer without sending a
// request of its own.
export function useAiGiftFromHeader(signedIn: boolean): AiGiftStatus | null {
  const { data } = useQuery({
    queryKey: [...AI_GIFT_QUERY_KEY, signedIn],
    queryFn: getAiGift,
    enabled: false,
  });
  return data ?? null;
}
