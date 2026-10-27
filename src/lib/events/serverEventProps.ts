export const ORDER_SOURCE_PROP = 'order_source';
export const ORDER_SOURCE_STRIPE_WEBHOOK = 'stripe_webhook';

// Marks an events row a scheduled job wrote for itself. Job bookkeeping that
// reads `events` filters on it so a client-posted row cannot stand in for one.
export const SERVER_MARKER_PROP = 'server_marker';

// Props a trusted server path may set but a client-submitted event must never
// carry. The /api/events/track ingest drops these so a client cannot forge a
// server-verified purchase into a report that trusts them (the Google Ads
// offline-conversion feed only counts rows the Stripe webhook marked).
export const SERVER_ONLY_EVENT_PROP_KEYS: ReadonlySet<string> = new Set([
  ORDER_SOURCE_PROP,
  SERVER_MARKER_PROP,
]);

// Event names only the server writes; no web or native client emits them.
// The ingest drops them outright: a forged tripwire check or alert row would
// skip a run or silence an alert, and forged conversion outcomes or upload
// starts would skew the rates the tripwire and the ops funnel read.
export const SERVER_ONLY_EVENT_NAMES: ReadonlySet<string> = new Set([
  'metric_tripwire_checked',
  'metric_tripwire_alert_sent',
  'conversion_succeeded',
  'conversion_failed',
  'upload_started',
]);
