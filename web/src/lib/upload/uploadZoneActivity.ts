import { useSyncExternalStore } from 'react';

export type UploadZoneActivity = 'absent' | 'idle' | 'busy';

let current: UploadZoneActivity = 'absent';
const listeners = new Set<() => void>();

export function reportUploadZoneActivity(activity: UploadZoneActivity): void {
  if (current === activity) return;
  current = activity;
  for (const listener of listeners) listener();
}

export function readUploadZoneActivity(): UploadZoneActivity {
  return current;
}

export function subscribeUploadZoneActivity(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useUploadZoneActivity(): UploadZoneActivity {
  return useSyncExternalStore(
    subscribeUploadZoneActivity,
    readUploadZoneActivity
  );
}
