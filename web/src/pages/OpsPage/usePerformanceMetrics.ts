import { useQuery } from '@tanstack/react-query';

import { PerformanceMetricsResponse } from './performanceTypes';

const REFRESH_MS = 30_000;
const REQUEST_TIMEOUT_MS = 20_000;

const fetchPerformanceMetrics =
  async (): Promise<PerformanceMetricsResponse> => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    let response: Response;
    try {
      response = await fetch('/api/ops/performance/metrics', {
        credentials: 'include',
        cache: 'no-store',
        signal: controller.signal,
      });
    } catch (error) {
      if (controller.signal.aborted) {
        throw new Error(
          `request timed out after ${REQUEST_TIMEOUT_MS / 1000}s`
        );
      }
      throw error;
    } finally {
      clearTimeout(timer);
    }
    if (!response.ok) {
      throw new Error(`${response.status} ${response.statusText}`);
    }
    const body = await response.text();
    if (body.trim() === '') {
      throw new Error('empty response body');
    }
    try {
      return JSON.parse(body) as PerformanceMetricsResponse;
    } catch {
      throw new Error('malformed response body');
    }
  };

export const usePerformanceMetrics = () => {
  return useQuery<PerformanceMetricsResponse, Error>({
    queryKey: ['ops-performance-metrics'],
    queryFn: fetchPerformanceMetrics,
    refetchInterval: REFRESH_MS,
    refetchOnWindowFocus: true,
  });
};
