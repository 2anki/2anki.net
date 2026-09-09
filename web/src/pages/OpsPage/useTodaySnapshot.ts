import { useQuery } from '@tanstack/react-query';

import { fetchOpsJson } from './fetchOpsJson';
import { TodaySnapshotResponse } from './todayTypes';

const REFRESH_MS = 60_000;

export const useTodaySnapshot = () =>
  useQuery<TodaySnapshotResponse, Error>({
    queryKey: ['ops-today'],
    queryFn: () => fetchOpsJson<TodaySnapshotResponse>('/api/ops/today'),
    refetchInterval: REFRESH_MS,
    refetchOnWindowFocus: true,
    refetchIntervalInBackground: false,
  });
