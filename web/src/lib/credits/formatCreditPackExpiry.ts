const CREDIT_PACK_EXPIRY_DAYS = 90;
const DAY_MS = 24 * 60 * 60 * 1000;

export function formatCreditPackExpiry(
  language: string,
  now: Date = new Date()
): string {
  const expiry = new Date(now.getTime() + CREDIT_PACK_EXPIRY_DAYS * DAY_MS);
  return expiry.toLocaleDateString(language, {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}
