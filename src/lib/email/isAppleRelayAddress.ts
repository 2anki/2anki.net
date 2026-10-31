const APPLE_RELAY_DOMAIN = '@privaterelay.appleid.com';

// Apple's Hide My Email relay forwards only mail from sender domains registered
// on our Sign in with Apple account, so billing email from the payment provider
// sent to one can vanish without a bounce.
export function isAppleRelayAddress(email: string): boolean {
  return email.trim().toLowerCase().endsWith(APPLE_RELAY_DOMAIN);
}
