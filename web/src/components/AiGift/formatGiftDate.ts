const dateLocale = (language: string): string =>
  language.startsWith('en') ? 'en-GB' : language;

export function formatGiftDate(iso: string, language: string): string {
  return new Date(iso).toLocaleString(dateLocale(language), {
    day: 'numeric',
    month: 'long',
    hour: '2-digit',
    minute: '2-digit',
  });
}
