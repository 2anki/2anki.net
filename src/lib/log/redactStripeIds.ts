// Stripe object ids (customers, subscriptions, payments, checkout sessions)
// reach error messages through Stripe's own errors and through knex, which
// interpolates query bindings into its messages. They must not be stored or
// logged (CWE-532). Requiring a digit keeps snake_case words such as
// `in_progress` intact.
const STRIPE_ID =
  /\b(?:cus|sub|si|pi|pm|ch|in|seti|re|txn|cs_test|cs_live)_(?=[A-Za-z0-9]*\d)[A-Za-z0-9]{4,}\b/g;

export function redactStripeIds(text: string): string {
  return text.replace(STRIPE_ID, '<stripe_id>');
}
