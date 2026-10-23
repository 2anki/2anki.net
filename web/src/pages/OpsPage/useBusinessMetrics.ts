import { useQuery } from '@tanstack/react-query';

import { BusinessMetricsResponse } from './businessTypes';

const REFRESH_MS = 30_000;

const fetchBusinessMetrics = async (): Promise<BusinessMetricsResponse> => {
  const response = await fetch('/api/ops/business/metrics', {
    credentials: 'include',
    cache: 'no-store',
  });
  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText}`);
  }
  return response.json();
};

export const useBusinessMetrics = () => {
  return useQuery<BusinessMetricsResponse, Error>({
    queryKey: ['ops-business-metrics'],
    queryFn: fetchBusinessMetrics,
    refetchInterval: REFRESH_MS,
    refetchOnWindowFocus: true,
    refetchIntervalInBackground: false,
  });
};
