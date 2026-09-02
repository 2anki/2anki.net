// These displayed prices MUST match the live Stripe prices behind the
// PASS_24H_PRICE_ID / PASS_7D_PRICE_ID / PASS_120D_PRICE_ID env vars — a
// mismatch shows one price on the page and charges another at checkout.
// The pricing.pass.semesterPerWeek i18n string also hardcodes math derived
// from the 120d ($29) and 7d ($12) values; re-derive it when either changes.
export const PASS_PRICES = {
  '24h': '$6',
  '7d': '$12',
  '120d': '$29',
} as const;
