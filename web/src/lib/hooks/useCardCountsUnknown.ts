import { useQuery } from '@tanstack/react-query';
import { getCardUsage } from '../backend/getCardUsage';
import { CARD_USAGE_QUERY_KEY } from './useCardUsage';

// useCardUsage reports a failed counts read as 0 of 100 used, which its
// callers rely on. This reads the same cached query, without fetching, to tell
// that failure apart from an account that really has every card left.
export function useCardCountsUnknown(
  accountId: number | null | undefined
): boolean {
  const { data, isFetched, isFetching } = useQuery({
    queryKey: [...CARD_USAGE_QUERY_KEY, accountId ?? null],
    queryFn: getCardUsage,
    enabled: false,
  });
  return isFetched && !isFetching && data == null;
}
