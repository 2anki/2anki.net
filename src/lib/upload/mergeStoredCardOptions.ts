/**
 * Card options a support switch may pin on the account. A stored value for
 * one of these wins over whatever the browser sent, so an ops-set recovery
 * switch is not defeated by a stale localStorage value. Closed set: extending
 * it is a product decision, not a convenience.
 */
const SUPPORT_OVERRIDE_KEYS = ['block-id-identity'] as const;

function stringEntries(stored: unknown): Record<string, string> {
  if (stored == null || typeof stored !== 'object' || Array.isArray(stored)) {
    return {};
  }
  return Object.fromEntries(
    Object.entries(stored).filter(
      (entry): entry is [string, string] => typeof entry[1] === 'string'
    )
  );
}

export function mergeStoredCardOptions(
  stored: unknown,
  body: Record<string, unknown>
): Record<string, unknown> {
  const storedOptions = stringEntries(stored);
  const merged: Record<string, unknown> = { ...storedOptions, ...body };
  for (const key of SUPPORT_OVERRIDE_KEYS) {
    if (storedOptions[key] != null) {
      merged[key] = storedOptions[key];
    }
  }
  return merged;
}
