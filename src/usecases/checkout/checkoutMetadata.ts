/**
 * Build the optional half of a Stripe Checkout session's metadata: keep only
 * the entries whose value is present (not null/undefined and not the empty
 * string). Every checkout use case stamps the same attribution fields
 * (pricing_variant, anon_id, surface, ga_client_id) this way, so the rule for
 * "is this value worth storing?" lives in one place.
 */
export function optionalMetadata(
  entries: Record<string, string | undefined>
): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(entries)) {
    if (value != null && value !== '') {
      result[key] = value;
    }
  }
  return result;
}

const ANON_ID_CONSENT_KEY = 'anon_id_consent';
const ANON_ID_CONSENT_GRANTED = 'granted';

/**
 * A pass session's anon_id binds the held deck to the buyer's browser, so it is
 * stamped whatever the visitor chose. This marker records, at checkout time,
 * whether the same id may also go on the webhook's checkout_completed event.
 */
export function anonIdConsentMetadata(
  trackingAllowed: boolean
): Record<string, string> {
  return trackingAllowed
    ? { [ANON_ID_CONSENT_KEY]: ANON_ID_CONSENT_GRANTED }
    : {};
}

export function consentedSessionAnonId(
  metadata: Record<string, string | undefined>
): string | null {
  const anonId = metadata.anon_id;
  if (anonId == null || anonId === '') {
    return null;
  }
  return metadata[ANON_ID_CONSENT_KEY] === ANON_ID_CONSENT_GRANTED
    ? anonId
    : null;
}
