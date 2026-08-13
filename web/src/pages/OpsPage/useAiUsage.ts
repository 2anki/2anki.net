import { useQuery } from '@tanstack/react-query';

import { AiUsageResponse, AiUsageWindow } from './aiUsageTypes';

const REFRESH_MS = 60_000;

const fetchAiUsage = async (
  window: AiUsageWindow
): Promise<AiUsageResponse> => {
  const response = await fetch(`/api/ops/ai-usage?window=${window}`, {
    credentials: 'include',
  });
  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText}`);
  }
  return response.json();
};

export const useAiUsage = (window: AiUsageWindow) => {
  return useQuery<AiUsageResponse, Error>({
    queryKey: ['ops-ai-usage', window],
    queryFn: () => fetchAiUsage(window),
    refetchInterval: REFRESH_MS,
    refetchOnWindowFocus: true,
    refetchIntervalInBackground: false,
  });
};
