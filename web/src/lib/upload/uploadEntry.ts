import { readUploadZoneActivity } from './uploadZoneActivity';

export interface UploadEntry {
  openPicker: () => void;
  showZone: () => void;
}

export type UploadEntryOutcome = 'picker' | 'zone' | 'page';

export const UPLOAD_ARRIVAL_WINDOW_MS = 10_000;

let entry: UploadEntry | null = null;
let showZoneUntil: number | null = null;

export function registerUploadEntry(
  next: UploadEntry,
  now: number = Date.now()
): () => void {
  entry = next;
  const arriving = showZoneUntil != null && now <= showZoneUntil;
  showZoneUntil = null;
  if (arriving) next.showZone();
  return () => {
    if (entry === next) entry = null;
  };
}

// The picker opens only from an idle zone, inside the tap that asked for it,
// which is what lets the browser allow it. A zone showing a result or a
// conversion is brought into view instead. With no zone on the page, the
// upload page shows its zone if it mounts within a few seconds, and only the
// first zone that mounts does.
export function chooseUploadFile(now: number = Date.now()): UploadEntryOutcome {
  if (entry == null) {
    showZoneUntil = now + UPLOAD_ARRIVAL_WINDOW_MS;
    return 'page';
  }
  if (readUploadZoneActivity() === 'idle') {
    entry.openPicker();
    return 'picker';
  }
  entry.showZone();
  return 'zone';
}

export function resetUploadEntryForTests(): void {
  entry = null;
  showZoneUntil = null;
}
