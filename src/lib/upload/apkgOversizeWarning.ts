// AnkiWeb refuses to sync a package over 100 MB, so a deck that size imports
// on one device and never reaches the others. The size is only known once the
// package is built, so the warning rides the existing upload warning channel.
export const APKG_SYNC_LIMIT_BYTES = 100 * 1024 * 1024;

export const APKG_OVERSIZE_WARNING_RE = /^apkg-over-100mb:(\d+)$/;

export function apkgOversizeWarning(bytes: number): string | null {
  if (bytes <= APKG_SYNC_LIMIT_BYTES) return null;
  return `apkg-over-100mb:${Math.round(bytes / (1024 * 1024))}`;
}

export function apkgOversizeWarningText(megabytes: number): string {
  return `This deck is ${megabytes} MB. AnkiWeb won't sync packages over 100 MB, so split it into smaller decks before syncing.`;
}
