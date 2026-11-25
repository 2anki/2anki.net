import { readUploadZoneActivity } from './uploadZoneActivity';

export interface UploadEntry {
  openPicker: () => void;
  showZone: () => void;
}

export type UploadEntryOutcome = 'picker' | 'zone' | 'page';

let entry: UploadEntry | null = null;
let showZoneOnArrival = false;

export function registerUploadEntry(next: UploadEntry): () => void {
  entry = next;
  if (showZoneOnArrival) {
    showZoneOnArrival = false;
    next.showZone();
  }
  return () => {
    if (entry === next) entry = null;
  };
}

// The picker opens only from an idle zone, inside the tap that asked for it,
// which is what lets the browser allow it. A zone showing a result or a
// conversion is brought into view instead. With no zone on the page, the
// upload page shows its zone once it mounts.
export function chooseUploadFile(): UploadEntryOutcome {
  if (entry == null) {
    showZoneOnArrival = true;
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
  showZoneOnArrival = false;
}
