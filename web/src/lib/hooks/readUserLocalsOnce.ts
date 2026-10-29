import type { QueryClient } from '@tanstack/react-query';

import { getUserLocals } from '../backend/getUserLocals';

// One read of the account with no retries, so a failure answers at once. It
// fills the same cache entry useUserLocals reads.
export function readUserLocalsOnce(queryClient: QueryClient) {
  return queryClient.fetchQuery({
    queryKey: ['userLocals'],
    queryFn: getUserLocals,
    retry: false,
    staleTime: 0,
  });
}
