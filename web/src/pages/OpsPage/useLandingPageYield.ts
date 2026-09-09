import { useQuery } from '@tanstack/react-query';

import { fetchOpsJson } from './fetchOpsJson';
import { LandingPageYieldResponse } from './landingPageYieldTypes';
import { OpsWindow } from './opsWindow';

const STALE_MS = 60_000;

export const useLandingPageYield = (window: OpsWindow) =>
  useQuery<LandingPageYieldResponse, Error>({
    queryKey: ['ops-landing-page-yield', window],
    queryFn: () =>
      fetchOpsJson<LandingPageYieldResponse>(
        `/api/ops/growth/landing-page-yield?window=${window}`
      ),
    staleTime: STALE_MS,
    refetchOnWindowFocus: false,
  });
