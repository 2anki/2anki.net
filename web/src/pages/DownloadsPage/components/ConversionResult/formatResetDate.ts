function dateLocale(language?: string): string {
  if (language == null || language.startsWith('en')) return 'en-GB';
  return language;
}

export function formatResetDate(
  iso?: string,
  language?: string
): string | null {
  if (iso == null) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat(dateLocale(language), {
    timeZone: 'UTC',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(date);
}
