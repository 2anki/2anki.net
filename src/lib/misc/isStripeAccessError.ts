// Stripe raises exactly these two error classes when the API key itself is
// rejected: an invalid key (StripeAuthenticationError) or a restricted key
// missing a permission the request needs (StripePermissionError). Both are
// configuration faults that affect every caller, not a single user's request,
// so they deserve an ops alert rather than a silent pm2 log line.
const STRIPE_ACCESS_ERROR_TYPES = new Set([
  'StripeAuthenticationError',
  'StripePermissionError',
]);

export function stripeAccessErrorType(error?: unknown): string | null {
  if (error == null) {
    return null;
  }
  const type = (error as { type?: unknown }).type;
  if (typeof type === 'string' && STRIPE_ACCESS_ERROR_TYPES.has(type)) {
    return type;
  }
  const name = (error as { name?: unknown }).name;
  if (typeof name === 'string' && STRIPE_ACCESS_ERROR_TYPES.has(name)) {
    return name;
  }
  return null;
}

export function isStripeAccessError(error?: unknown): boolean {
  return stripeAccessErrorType(error) != null;
}
