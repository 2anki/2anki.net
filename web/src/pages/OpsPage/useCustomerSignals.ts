import { useQuery } from '@tanstack/react-query';

import { CustomerSignalsResponse } from './customerSignalsTypes';
import { fetchOpsJson } from './fetchOpsJson';
import { OpsWindow } from './opsWindow';

const STALE_MS = 60_000;

export const useCustomerSignals = (window: OpsWindow) =>
  useQuery<CustomerSignalsResponse, Error>({
    queryKey: ['ops-customer-signals', window],
    queryFn: () =>
      fetchOpsJson<CustomerSignalsResponse>(
        `/api/ops/growth/customer-signals?window=${window}`
      ),
    staleTime: STALE_MS,
    refetchOnWindowFocus: false,
  });
