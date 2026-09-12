// AnkiWeb refuses to sync a package over 100 MB, so a deck that size imports
// on one device and never reaches the others. The size is only known once the
// package is built, so the warning rides the existing upload warning channel.
export const APKG_SYNC_LIMIT_BYTES = 100 * 1024 * 1024;

export const APKG_OVERSIZE_WARNING_RE = /^apkg-over-100mb:(\d+\.\d)$/;

const MEGABYTE = 1024 * 1024;

// One decimal, rounded up, so a package one byte over the limit reads
// 100.1 MB rather than contradicting the sentence that follows.
export function apkgOversizeWarning(bytes: number): string | null {
  if (bytes <= APKG_SYNC_LIMIT_BYTES) return null;
  const tenths = Math.ceil((bytes / MEGABYTE) * 10) / 10;
  return `apkg-over-100mb:${tenths.toFixed(1)}`;
}

export function apkgOversizeWarningText(megabytes: number): string {
  return `This deck is ${megabytes.toFixed(1)} MB. AnkiWeb won't sync packages over 100 MB, so split it into smaller decks before syncing.`;
}
