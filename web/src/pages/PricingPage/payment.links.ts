// Fallback pass prices shown instantly on first paint and whenever the live
// GET /api/pricing lookup has not resolved yet. The live endpoint resolves
// amounts from Stripe by price metadata, so these values only surface during
// loading or if the endpoint is unavailable — they must match the live Stripe
// prices so a brief fallback render never disagrees with checkout.
// The pricing.pass.semesterPerWeek i18n string still hardcodes math derived
// from the 120d and 7d values; re-derive it when either changes.
export const FALLBACK_PASS_PRICES = {
  '24h': '$6',
  '7d': '$12',
  '120d': '$29',
} as const;
