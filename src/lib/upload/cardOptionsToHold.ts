// A held deck is rebuilt later with nobody on the page to answer "what should
// this PDF become", so the attempt-scoped question never travels with it.
const NOT_HELD_KEYS = new Set(['pdf-fallback']);

export function cardOptionsToHold(
  resolved: unknown
): Record<string, string> | null {
  if (resolved == null || typeof resolved !== 'object') {
    return null;
  }
  if (Array.isArray(resolved)) {
    return null;
  }
  const kept = Object.entries(resolved).filter(
    (entry): entry is [string, string] =>
      typeof entry[1] === 'string' && !NOT_HELD_KEYS.has(entry[0])
  );
  return kept.length === 0 ? null : Object.fromEntries(kept);
}
