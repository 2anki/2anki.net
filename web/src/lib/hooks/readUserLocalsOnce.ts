import type { QueryClient } from '@tanstack/react-query';

import { getUserLocals } from '../backend/getUserLocals';

// One read of the account with no retries of its own, so a failure answers at
// once. It fills the same cache entry useUserLocals reads, and a failure keeps
// the data already there. A useUserLocals read already in flight is joined
// rather than replaced, so that read's retries apply; the caller's time cap
// still ends the wait and treats the account as unconfirmed.
export function readUserLocalsOnce(queryClient: QueryClient) {
  return queryClient.fetchQuery({
    queryKey: ['userLocals'],
    queryFn: getUserLocals,
    retry: false,
    staleTime: 0,
  });
}
