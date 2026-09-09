import { useCallback, useEffect, useState } from 'react';
import { Query, useIsFetching, useQueryClient } from '@tanstack/react-query';

const TICK_MS = 10_000;

export const isOpsQuery = (query: Query): boolean =>
  typeof query.queryKey[0] === 'string' && query.queryKey[0].startsWith('ops-');

export const formatAge = (ageMs: number | null): string => {
  if (ageMs == null) return '—';
  if (ageMs < 1_000) return 'just now';
  if (ageMs < 60_000) return `${Math.floor(ageMs / 1_000)}s ago`;
  if (ageMs < 3_600_000) return `${Math.floor(ageMs / 60_000)}m ago`;
  return `${Math.floor(ageMs / 3_600_000)}h ago`;
};

interface OpsFreshness {
  ageMs: number | null;
  fetching: boolean;
  refresh: () => void;
}

export function useOpsFreshness(): OpsFreshness {
  const queryClient = useQueryClient();
  const latestUpdatedAt = useCallback((): number | null => {
    const stamps = queryClient
      .getQueryCache()
      .findAll({ predicate: isOpsQuery })
      .map((query) => query.state.dataUpdatedAt)
      .filter((stamp) => stamp > 0);
    return stamps.length === 0 ? null : Math.max(...stamps);
  }, [queryClient]);

  const [updatedAt, setUpdatedAt] = useState<number | null>(latestUpdatedAt);
  const [now, setNow] = useState<number>(() => Date.now());

  useEffect(() => {
    const unsubscribe = queryClient.getQueryCache().subscribe(() => {
      setUpdatedAt(latestUpdatedAt());
      setNow(Date.now());
    });
    const timer = setInterval(() => setNow(Date.now()), TICK_MS);
    return () => {
      unsubscribe();
      clearInterval(timer);
    };
  }, [queryClient, latestUpdatedAt]);

  const fetching = useIsFetching({ predicate: isOpsQuery }) > 0;
  const refresh = useCallback(() => {
    void queryClient.refetchQueries({ predicate: isOpsQuery, type: 'active' });
  }, [queryClient]);

  return {
    ageMs: updatedAt == null ? null : Math.max(0, now - updatedAt),
    fetching,
    refresh,
  };
}
