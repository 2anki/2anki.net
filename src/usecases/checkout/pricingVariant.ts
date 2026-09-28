const VALID_PRICING_VARIANTS = new Set([
  'passes-first',
  'unlimited-first',
  'minimal',
  'semester-first',
]);

/**
 * Accept only the known A/B variant labels from request input so that nothing
 * arbitrary lands in Stripe session metadata or the events table.
 */
export function parsePricingVariant(value: unknown): string | undefined {
  return typeof value === 'string' && VALID_PRICING_VARIANTS.has(value)
    ? value
    : undefined;
}
