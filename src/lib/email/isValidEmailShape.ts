const EMAIL_MAX_LENGTH = 254;
// Angle brackets and commas are excluded on purpose: SendGrid parses
// "display <addr@example.com>" and would deliver to the inner address, so a
// bracketed string is a different recipient than the string we validated.
const EMAIL_SHAPE = /^[^\s@<>,;]+@[^\s@<>,;]+\.[^\s@<>,;]+$/;

// Normalizes to the exact string that must be used for BOTH the recipient and
// any per-address bookkeeping. Returning the normalized value (rather than a
// boolean) keeps callers from validating one form and sending another.
export function normalizeEmail(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().toLowerCase();
  if (normalized.length > EMAIL_MAX_LENGTH) return null;
  return EMAIL_SHAPE.test(normalized) ? normalized : null;
}

export function isValidEmailShape(value: unknown): value is string {
  return normalizeEmail(value) !== null;
}
