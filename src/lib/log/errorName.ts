// The error class is safe to log; a message, cause or request config can
// carry a secret (the GA4 Measurement Protocol URL holds api_secret).
export function errorName(error: unknown): string {
  const name = (error as { name?: unknown })?.name;
  return typeof name === 'string' && name.length > 0 ? name : 'Error';
}
