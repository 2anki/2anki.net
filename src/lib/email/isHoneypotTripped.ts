// The contact form renders this field visually hidden and skipped by keyboard
// and screen readers, so a human never fills it. Bots autofill every input
// they find, and "website" is deliberate bait — autofillers target the name.
export const HONEYPOT_FIELD = 'website';

export function isHoneypotTripped(value: unknown): boolean {
  return value != null && String(value).trim().length > 0;
}
