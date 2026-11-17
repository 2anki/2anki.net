export function formatPassEnd(
  expiresAt: string,
  language?: string
): string | null {
  const parsed = new Date(expiresAt);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }
  return parsed.toLocaleString(language, {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}
