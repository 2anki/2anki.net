import { useQuery } from '@tanstack/react-query';

import { fetchOpsJson } from './fetchOpsJson';
import { OpsWindow } from './opsWindow';
import { UploadFunnelResponse } from './uploadFunnelTypes';

const STALE_MS = 60_000;

export const useUploadFunnel = (window: OpsWindow) =>
  useQuery<UploadFunnelResponse, Error>({
    queryKey: ['ops-upload-funnel', window],
    queryFn: () =>
      fetchOpsJson<UploadFunnelResponse>(
        `/api/ops/upload-funnel?window=${window}`
      ),
    staleTime: STALE_MS,
    refetchOnWindowFocus: false,
  });
