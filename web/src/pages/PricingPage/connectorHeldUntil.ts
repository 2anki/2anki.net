const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

// The connector links here with the UTC day its saved deck expires, without
// the time. The hold may end at any moment of that day, so the page promises
// the deck only while that day is still ahead; on the day itself, and for a
// stale or hand-edited link, it falls back to the plain connector page.
export function connectorHeldUntil(
  raw: string | null,
  now: Date = new Date()
): string | null {
  const match = raw == null ? null : ISO_DATE.exec(raw);
  if (match == null) {
    return null;
  }
  const [, year, month, day] = match.map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null;
  }
  const today = Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate()
  );
  return date.getTime() > today ? raw : null;
}

export function formatHeldUntil(isoDate: string, language: string): string {
  return new Intl.DateTimeFormat(language, {
    day: 'numeric',
    month: 'long',
    timeZone: 'UTC',
  }).format(new Date(`${isoDate}T00:00:00Z`));
}
