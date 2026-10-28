export const ORDER_SOURCE_PROP = 'order_source';
export const ORDER_SOURCE_STRIPE_WEBHOOK = 'stripe_webhook';

// Marks an events row a scheduled job or dedup wrote for itself. Bookkeeping
// that reads `events` trusts marked rows so a client-posted row cannot stand
// in for one.
export const SERVER_MARKER_PROP = 'server_marker';

export function withServerMarker<T extends Record<string, unknown>>(
  props: T
): T & { server_marker: true } {
  return { ...props, server_marker: true };
}

// Props a trusted server path may set but a client-submitted event must never
// carry. The /api/events/track ingest drops these so a client cannot forge a
// server-verified purchase into a report that trusts them (the Google Ads
// offline-conversion feed only counts rows the Stripe webhook marked).
export const SERVER_ONLY_EVENT_PROP_KEYS: ReadonlySet<string> = new Set([
  ORDER_SOURCE_PROP,
  SERVER_MARKER_PROP,
]);

// Event names only the server writes; no web or native client emits them.
// The ingest drops them outright. A forged job record (email_batch_sent,
// inactive_users_deleted, the tripwire check) would skip a scheduled run, a
// forged dedup record (ai_spend_alert_sent, ai_credits_exhausted, the tripwire
// alert) would silence an alert, forged conversion outcomes or upload starts
// would skew the rates the tripwire and the ops funnel read, and a forged MCP
// tool call would count as activity that keeps an account from inactivity
// deletion.
export const SERVER_ONLY_EVENT_NAMES: ReadonlySet<string> = new Set([
  'metric_tripwire_checked',
  'metric_tripwire_alert_sent',
  'conversion_succeeded',
  'conversion_failed',
  'upload_started',
  'email_batch_sent',
  'inactive_users_deleted',
  'ai_spend_alert_sent',
  'ai_credits_exhausted',
  'mcp_tool_called',
  'mcp_tool_result',
]);
