import {
  getStripe,
  updateStoreSubscription,
} from '../../../integrations/stripe';
import { getDatabase } from '../../../../data_layer';
import type { Knex } from 'knex';
import type StripeTypes from 'stripe';
import { reconcileActiveSubscriptions } from './reconcileActiveSubscriptions';
import { withStripeRetry } from './withStripeRetry';
import { emailHash } from '../../../emailHash';

function shortHash(value: string): string {
  return emailHash(value).slice(-8);
}

// A database or Stripe error's message and detail can carry the email or the
// customer id, so only its class and code are logged.
function errorSummary(error: unknown): string[] {
  const { name, code } = (error ?? {}) as { name?: string; code?: string };
  return [`error=${name ?? 'unknown'}`, `code=${code ?? 'none'}`];
}

const stripe = getStripe();
const database = getDatabase();

/**
 * Max subscriptions processed concurrently in the forward sync. Each one fires
 * a Stripe customers.retrieve; a wide Promise.all over the batch (up to 100)
 * bursts past Stripe's rate limit and throttles live payment traffic during the
 * run. A small cap keeps the sync comfortably under the limit.
 */
const FORWARD_SYNC_CONCURRENCY = 5;

/**
 * Runs `worker` over `items` with at most `concurrency` in flight at a time,
 * processing sequential slices so a large batch never bursts all at once.
 */
export async function mapWithConcurrency<T>(
  items: readonly T[],
  concurrency: number,
  worker: (item: T) => Promise<void>
): Promise<void> {
  const size = concurrency > 0 ? concurrency : 1;
  for (let i = 0; i < items.length; i += size) {
    await Promise.all(items.slice(i, i + size).map(worker));
  }
}

/**
 * Fetches a batch of active subscriptions from Stripe
 */
function fetchSubscriptionBatch(startingAfter?: string) {
  return withStripeRetry(
    () =>
      stripe.subscriptions.list({
        limit: 100,
        status: 'active',
        starting_after: startingAfter,
      }),
    'fetchSubscriptionBatch'
  );
}

/**
 * Retrieves customer information from Stripe
 */
async function getCustomer(
  customerId: string
): Promise<StripeTypes.Customer | null> {
  try {
    const customer = await withStripeRetry(
      () => stripe.customers.retrieve(customerId),
      'getCustomer'
    );
    if ('email' in customer && customer.email) {
      return customer as StripeTypes.Customer;
    }
    console.warn(
      'Customer does not have an email',
      `customer=${shortHash(customerId)}`
    );
    return null;
  } catch (error) {
    console.error(
      'Error retrieving customer',
      `customer=${shortHash(customerId)}`,
      ...errorSummary(error)
    );
    return null;
  }
}

/**
 * Processes a single subscription
 */
async function processSubscription(
  db: Knex,
  subscription: StripeTypes.Subscription
): Promise<void> {
  try {
    if (typeof subscription.customer !== 'string') {
      console.warn('Subscription has non-string customer ID', subscription.id);
      return;
    }

    const customer = await getCustomer(subscription.customer);
    if (!customer) return;

    // The same write the webhooks use, so a sync run can never disagree with
    // them: paused and past-due handling, developer tiers, the linked account
    // and the customer id stamp all live in one place.
    await updateStoreSubscription(db, customer, subscription);
  } catch (error) {
    console.error(
      'Error processing subscription',
      subscription.id,
      ...errorSummary(error)
    );
    // We don't rethrow here to allow processing of other subscriptions
  }
}

/**
 * Updates the pagination parameters based on the subscription batch
 */
function updatePaginationParams(
  subscriptions: StripeTypes.ApiList<StripeTypes.Subscription>
): {
  hasMore: boolean;
  startingAfter?: string;
} {
  const hasMore = subscriptions.has_more;
  let startingAfter: string | undefined = undefined;

  if (hasMore && subscriptions.data.length > 0) {
    startingAfter = subscriptions.data[subscriptions.data.length - 1].id;
    console.info(
      `More subscriptions available, next starting point: ${startingAfter}`
    );
  } else {
    console.info('No more subscriptions to fetch');
  }

  return { hasMore, startingAfter };
}

/**
 * Main function to synchronize Stripe subscriptions with the database
 */
async function updateStripeSubscriptions(db: Knex = database): Promise<void> {
  let hasMore = true;
  let startingAfter: string | undefined = undefined;

  console.info('Starting subscription sync with Stripe');

  try {
    while (hasMore) {
      console.info(
        `Fetching subscriptions${startingAfter ? ' after ' + startingAfter : ''}`
      );

      const subscriptions = await fetchSubscriptionBatch(startingAfter);
      console.info(`Processing ${subscriptions.data.length} subscriptions`);

      // If no subscriptions were returned, exit the loop
      if (subscriptions.data.length === 0) {
        console.info('No more subscriptions to process');
        break;
      }

      // Process with bounded concurrency so the batch's customers.retrieve
      // calls don't burst past Stripe's rate limit and throttle live traffic.
      await mapWithConcurrency(
        subscriptions.data,
        FORWARD_SYNC_CONCURRENCY,
        (subscription) => processSubscription(db, subscription)
      );

      // Update pagination parameters
      const pagination = updatePaginationParams(subscriptions);
      hasMore = pagination.hasMore;
      startingAfter = pagination.startingAfter;
    }

    console.info('Forward sync from Stripe completed successfully');

    await reconcileActiveSubscriptions(db, stripe);
    console.info('Subscription sync completed successfully');
  } catch (error) {
    console.error('Error in updateStripeSubscriptions:', error);
    throw error; // Re-throw to be caught by the caller
  }
}

// Export for testing and importing elsewhere
export { updateStripeSubscriptions };

// Run directly if this file is executed directly
if (require.main === module) {
  updateStripeSubscriptions()
    .catch(console.error)
    .finally(async () => {
      await database.destroy(); // 🔥 properly close DB connection
    });
}
