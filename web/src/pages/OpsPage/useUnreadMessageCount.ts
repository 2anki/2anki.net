import { useQuery } from '@tanstack/react-query';

import { get2ankiApi } from '../../lib/backend/get2ankiApi';

const REFRESH_MS = 5 * 60_000;

export function useUnreadMessageCount(enabled: boolean): number {
  const { data } = useQuery<number, Error>({
    queryKey: ['ops-unread-messages'],
    queryFn: async () => {
      const messages = await get2ankiApi().listContactMessages();
      return messages.filter((message) => !message.is_acknowledged).length;
    },
    enabled,
    retry: false,
    staleTime: REFRESH_MS,
    refetchInterval: REFRESH_MS,
    refetchIntervalInBackground: false,
  });
  return data ?? 0;
}
