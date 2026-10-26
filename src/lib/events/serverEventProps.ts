export const ORDER_SOURCE_PROP = 'order_source';
export const ORDER_SOURCE_STRIPE_WEBHOOK = 'stripe_webhook';

// Props a trusted server path may set but a client-submitted event must never
// carry. The /api/events/track ingest drops these so a client cannot forge a
// server-verified purchase into a report that trusts them (the Google Ads
// offline-conversion feed only counts rows the Stripe webhook marked).
export const SERVER_ONLY_EVENT_PROP_KEYS: ReadonlySet<string> = new Set([
  ORDER_SOURCE_PROP,
]);
