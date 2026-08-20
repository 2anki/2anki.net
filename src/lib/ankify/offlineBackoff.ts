export const OFFLINE_LAPSE_MS = 7 * 24 * 60 * 60 * 1000;
export const LAPSED_RETRY_INTERVAL_MS = 60 * 60 * 1000;

const OFFLINE_ERROR_PREFIX = 'Anki client offline';

export interface OfflineBackoffSubscription {
  last_error: string | null;
  last_synced_at: Date | null;
  last_polled_at: Date | null;
  created_at: Date | null;
}

export function shouldSkipLapsedOfflinePoll(
  subscription: OfflineBackoffSubscription,
  now: Date
): boolean {
  const { last_error, last_synced_at, last_polled_at, created_at } =
    subscription;
  if (last_error == null || !last_error.startsWith(OFFLINE_ERROR_PREFIX)) {
    return false;
  }
  const offlineAnchor = last_synced_at ?? created_at;
  if (offlineAnchor == null) {
    return false;
  }
  if (now.getTime() - offlineAnchor.getTime() < OFFLINE_LAPSE_MS) {
    return false;
  }
  if (last_polled_at == null) {
    return false;
  }
  return now.getTime() - last_polled_at.getTime() < LAPSED_RETRY_INTERVAL_MS;
}
