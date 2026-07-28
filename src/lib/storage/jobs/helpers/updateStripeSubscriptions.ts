import {
  getStripe,
  extractProductId,
  isDeveloperTierProduct,
} from '../../../integrations/stripe';
import { DeveloperSubscriptionsRepository } from '../../../../data_layer/DeveloperSubscriptionsRepository';
import { getDatabase } from '../../../../data_layer';
import { Knex } from 'knex';
import type { Stripe as StripeTypes } from 'stripe/cjs/stripe.core';
import { reconcileActiveSubscriptions } from './reconcileActiveSubscriptions';
import { withStripeRetry } from './withStripeRetry';
import { emailHash } from '../../../emailHash';

function shortHash(value: string): string {
  return emailHash(value).slice(-8);
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
      error
    );
    return null;
  }
}

/**
 * Updates or creates a subscription record in the database
 */
/**
 * Determines if a subscription should be considered active based on its status and cancellation schedule
 */
function determineSubscriptionActiveStatus(
  subscription: StripeTypes.Subscription,
  email: string
): boolean {
  const isActive = subscription.status === 'active';
  const isCancelScheduled = subscription.cancel_at_period_end === true;

  // If not active or not scheduled for cancellation, just return the active status
  if (!isActive || !isCancelScheduled) {
    return isActive;
  }

  // For subscriptions scheduled for cancellation, check if we're still in the paid period
  const periodEndDate = new Date((subscription.cancel_at ?? 0) * 1000);
  const currentDate = new Date();
  const shouldRemainActive = currentDate < periodEndDate;

  if (shouldRemainActive) {
    console.info(
      `Subscription for email=${shortHash(email)} is scheduled for cancellation but still active until ${periodEndDate.toISOString()}`
    );
  }

  return shouldRemainActive;
}

/**
 * Updates an existing subscription record in the database
 */
async function updateExistingSubscription(
  db: Knex,
  email: string,
  subscription: StripeTypes.Subscription,
  shouldRemainActive: boolean,
  existingActive: boolean
): Promise<void> {
  const statusChanged = existingActive !== shouldRemainActive;
  const payload = JSON.stringify(subscription);
  const stripeProductId = extractProductId(subscription);

  if (statusChanged) {
    console.info(
      `Updating subscription status for email=${shortHash(email)} to ${shouldRemainActive ? 'active' : 'inactive'}`
    );
    await db.table('subscriptions').where({ email }).update({
      active: shouldRemainActive,
      payload,
      stripe_product_id: stripeProductId,
    });
  } else {
    console.info(
      `Subscription status for email=${shortHash(email)} remains ${shouldRemainActive ? 'active' : 'inactive'}`
    );
    await db
      .table('subscriptions')
      .where({ email })
      .update({ payload, stripe_product_id: stripeProductId });
  }
}

/**
 * Creates a new subscription record in the database
 */
async function createNewSubscription(
  db: Knex,
  email: string,
  customerId: string,
  subscription: StripeTypes.Subscription,
  shouldRemainActive: boolean
): Promise<void> {
  console.info(
    `Creating subscription for customer=${shortHash(customerId)} email=${shortHash(email)} active=${shouldRemainActive}`
  );
  await db.table('subscriptions').insert({
    email,
    active: shouldRemainActive,
    payload: JSON.stringify(subscription),
    stripe_product_id: extractProductId(subscription),
  });
}

/**
 * Updates or creates a subscription record in the database
 */
async function updateSubscriptionRecord(
  db: Knex,
  customer: StripeTypes.Customer,
  subscription: StripeTypes.Subscription
): Promise<void> {
  const email = customer.email!.toLowerCase();

  try {
    const shouldRemainActive = determineSubscriptionActiveStatus(
      subscription,
      email
    );

    // The ops Sync button reaches this path directly, bypassing
    // updateStoreSubscription. Without the same check, one press writes every
    // developer tier back into the email-keyed subscriptions table and
    // re-creates exactly the collapse this table exists to prevent — granting
    // base-plan perks to a dev-tier-only buyer, and overwriting a concurrent
    // base subscriber's active flag and product id.
    const productId = extractProductId(subscription);
    if (productId != null && (await isDeveloperTierProduct(db, productId))) {
      await new DeveloperSubscriptionsRepository(db).upsert({
        stripeSubscriptionId: subscription.id,
        userId: null,
        email,
        stripeProductId: productId,
        active: shouldRemainActive,
        payload: subscription,
      });
      return;
    }

    const existingSubscription = await db
      .table('subscriptions')
      .where({ email })
      .first();

    if (existingSubscription) {
      await updateExistingSubscription(
        db,
        email,
        subscription,
        shouldRemainActive,
        existingSubscription.active
      );
    } else {
      await createNewSubscription(
        db,
        email,
        customer.id,
        subscription,
        shouldRemainActive
      );
    }

    await db
      .table('users')
      .where({ email })
      .update({ stripe_customer_id: customer.id });
  } catch (error) {
    console.error(
      'Error updating subscription record',
      `customer=${shortHash(customer.id)}`,
      `email=${shortHash(email)}`,
      error
    );
    throw error;
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

    await updateSubscriptionRecord(db, customer, subscription);
  } catch (error) {
    console.error('Error processing subscription', subscription.id, error);
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
async function updateStripeSubscriptions(): Promise<void> {
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
        (subscription) => processSubscription(database, subscription)
      );

      // Update pagination parameters
      const pagination = updatePaginationParams(subscriptions);
      hasMore = pagination.hasMore;
      startingAfter = pagination.startingAfter;
    }

    console.info('Forward sync from Stripe completed successfully');

    await reconcileActiveSubscriptions(database, stripe);
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
