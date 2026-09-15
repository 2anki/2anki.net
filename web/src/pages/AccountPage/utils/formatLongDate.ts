export function formatLongDate(
  date: Date,
  locale?: string,
  timeZone?: string
): string {
  return date.toLocaleDateString(locale, {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    ...(timeZone != null ? { timeZone } : {}),
  });
}
