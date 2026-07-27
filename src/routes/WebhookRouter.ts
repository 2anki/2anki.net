import express from 'express';
import type { Stripe as StripeTypes } from 'stripe/cjs/stripe.core';

import {
  extractProductId,
  getCustomerId,
  getStripe,
  normalizeEmail,
  resolveAccountForSubscription,
  updateStoreSubscription,
} from '../lib/integrations/stripe';
import { getDatabase } from '../data_layer';
import { StripeController } from '../controllers/StripeController/StripeController';
import UsersRepository from '../data_layer/UsersRepository';
import UserPassRepository, {
  type PassKind,
} from '../data_layer/UserPassRepository';
import AnonymousPassRepository from '../data_layer/AnonymousPassRepository';
import TokenRepository from '../data_layer/TokenRepository';
import AuthenticationService from '../services/AuthenticationService';
import UsersService from '../services/UsersService';
import { getDefaultEmailService } from '../services/EmailService/EmailService';
import { PersistStripeSessionUseCase } from '../usecases/checkout/PersistStripeSessionUseCase';
import hashToken from '../lib/misc/hashToken';
import { emailHash } from '../lib/emailHash';
import { track } from '../services/events/track';
import { getEventsSink } from '../services/events/eventsSinkInstance';
import AbandonedCheckoutRecoveryRepository from '../data_layer/AbandonedCheckoutRecoveryRepository';
import { SendAbandonedCheckoutRecoveryOnExpiryUseCase } from '../usecases/ops/SendAbandonedCheckoutRecoveryOnExpiryUseCase';
import { UserVisibleErrorsRepository } from '../data_layer/UserVisibleErrorsRepository';
import { RecordUserVisibleErrorUseCase } from '../usecases/observability/RecordUserVisibleErrorUseCase';
import { recordStripeWebhook } from '../services/stripeWebhookTimestamp';

const DURATION_24H_MS = 24 * 60 * 60 * 1000;
const DURATION_7D_MS = 7 * 24 * 60 * 60 * 1000;

const WebhooksRouter = () => {
  const router = express.Router();
  const database = getDatabase();
  const stripe = getStripe();
  const usersRepository = new UsersRepository(database);
  const tokenRepository = new TokenRepository(database);
  const authService = new AuthenticationService(
    tokenRepository,
    usersRepository
  );
  const usersService = new UsersService(
    usersRepository,
    getDefaultEmailService()
  );
  const persistStripeSessionUseCase = new PersistStripeSessionUseCase(
    stripe,
    database
  );
  const controller = new StripeController(
    authService,
    usersService,
    persistStripeSessionUseCase,
    stripe,
    new UserPassRepository(database)
  );
  const abandonedCheckoutRecoveryUseCase =
    new SendAbandonedCheckoutRecoveryOnExpiryUseCase(
      new AbandonedCheckoutRecoveryRepository(database),
      getDefaultEmailService(),
      getEventsSink()
    );
  const recordErrorUseCase = new RecordUserVisibleErrorUseCase(
    new UserVisibleErrorsRepository(database)
  );

  /**
   * @swagger
   * /webhook:
   *   post:
   *     summary: Stripe webhook handler
   *     description: Handle Stripe webhook events for payment processing and subscription management
   *     tags: [Webhooks]
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             description: Stripe webhook event payload
   *     responses:
   *       200:
   *         description: Webhook processed successfully
   *       400:
   *         description: Invalid webhook signature or payload
   *         content:
   *           text/plain:
   *             schema:
   *               type: string
   *               example: "Webhook Error: Invalid signature"
   *     security: []
   *     x-webhook-events:
   *       - customer.subscription.updated
   *       - customer.subscription.deleted
   *       - checkout.session.completed
   *       - checkout.session.expired
   */
  router.post(
    '/webhook',
    // @ts-ignore
    express.raw({ type: 'application/json' }),
    async (
      request: express.Request,
      response: express.Response
    ): Promise<void> => {
      const sig = request.headers['stripe-signature'];
      const stripe = getStripe();
      let event;

      try {
        event = stripe.webhooks.constructEvent(
          request.body,
          // @ts-ignore
          sig,
          process.env.STRIPE_ENDPOINT_SECRET
        );
      } catch (err) {
        const rawMessage = err instanceof Error ? err.message : String(err);
        const truncatedMessage = rawMessage.slice(0, 200);
        await recordErrorUseCase.execute({
          userId: null,
          surface: 'stripe_webhook',
          code: 'stripe_webhook_signature_invalid',
          context: { message: truncatedMessage },
        });
        // @ts-ignore
        response.status(400).send(`Webhook Error: ${err.message}`);
        console.error(err);
        return;
      }

      recordStripeWebhook();

      const alertUnlinkedPayment = async (
        customer: StripeTypes.Customer,
        subscription: StripeTypes.Subscription,
        customerId: string | null
      ): Promise<void> => {
        await recordErrorUseCase.execute({
          userId: null,
          surface: 'stripe_provisioning',
          code: 'unlinked_payment',
          context: {
            email_hash:
              customer.email != null ? hashToken(customer.email) : null,
            customer_id_hash: customerId != null ? hashToken(customerId) : null,
            product_id: extractProductId(subscription),
          },
        });
        console.error(
          '[webhook] unlinked payment: no account resolved for active subscription',
          {
            customer_id_hash: customerId != null ? hashToken(customerId) : null,
          }
        );
      };

      const provisionSubscription = async (
        subscription: StripeTypes.Subscription
      ): Promise<boolean> => {
        const customerId = getCustomerId(subscription.customer as string);
        if (customerId == null) {
          console.error('No customer ID found');
          return false;
        }
        const customer = (await stripe.customers.retrieve(
          customerId
        )) as StripeTypes.Customer;
        const provisionResult = await updateStoreSubscription(
          getDatabase(),
          customer,
          subscription
        );
        if (provisionResult.status === 'unlinked') {
          await alertUnlinkedPayment(customer, subscription, customerId);
        }
        return true;
      };

      // Handle the event
      switch (event.type) {
        case 'customer.subscription.created': {
          const subscriptionCreated = event.data
            .object as StripeTypes.Subscription;
          await provisionSubscription(subscriptionCreated);
          break;
        }
        case 'customer.subscription.updated':
          const customerSubscriptionUpdated = event.data.object;
          const customerId = getCustomerId(
            customerSubscriptionUpdated.customer as string
          );
          if (!customerId) {
            console.error('No customer ID found');
            return;
          }
          const customer = (await stripe.customers.retrieve(
            customerId
          )) as StripeTypes.Customer;

          {
            const updatedProvisionResult = await updateStoreSubscription(
              getDatabase(),
              customer,
              customerSubscriptionUpdated
            );
            if (
              updatedProvisionResult.status === 'unlinked' &&
              customerSubscriptionUpdated.status === 'active'
            ) {
              await alertUnlinkedPayment(
                customer,
                customerSubscriptionUpdated,
                customerId
              );
            }

            const previousPause = (
              event.data.previous_attributes as {
                pause_collection?: unknown;
              } | null
            )?.pause_collection;
            const autoResumed =
              previousPause != null &&
              customerSubscriptionUpdated.pause_collection == null &&
              customerSubscriptionUpdated.status === 'active';
            if (autoResumed) {
              track('subscription_pause_resumed', {
                userId: updatedProvisionResult.resolvedUserId,
                props: { trigger: 'stripe_auto_resume' },
              });
            }
          }

          {
            const updatedProductId =
              customerSubscriptionUpdated.items?.data?.[0]?.price?.product;
            const autoSyncProductId = process.env.AUTO_SYNC_PRODUCT_ID;
            if (
              autoSyncProductId != null &&
              updatedProductId === autoSyncProductId
            ) {
              if (customerSubscriptionUpdated.status === 'active') {
                console.info('auto_sync.subscription.activated', {
                  subscription_status: customerSubscriptionUpdated.status,
                });
              } else if (
                customerSubscriptionUpdated.cancel_at_period_end === true
              ) {
                console.info('auto_sync.subscription.canceled', {
                  subscription_status: customerSubscriptionUpdated.status,
                  access_until: new Date(
                    (customerSubscriptionUpdated.cancel_at ?? 0) * 1000
                  ).toISOString(),
                });
              }
            }
          }

          if (
            customerSubscriptionUpdated.cancel_at_period_end === true &&
            event.data.previous_attributes?.cancel_at_period_end === false &&
            'email' in customer
          ) {
            console.info(
              `Subscription cancellation scheduled for user ${customer.email}, ` +
                `access remains until ${new Date((customerSubscriptionUpdated.cancel_at ?? 0) * 1000).toISOString()}`
            );
          }
          break;
        case 'customer.subscription.deleted':
          const customerSubscriptionDeleted = event.data.object;
          if (typeof customerSubscriptionDeleted.customer === 'string') {
            const deletedCustomerId = getCustomerId(
              customerSubscriptionDeleted.customer
            );
            if (!deletedCustomerId) {
              console.error('No customer ID found');
              return;
            }
            const customerDeleted =
              await stripe.customers.retrieve(deletedCustomerId);

            // Guarding on the payer email alone treats every subscription paid
            // under a different address than the account — the supported
            // linked_email shape — as belonging to nobody, so the row stays
            // active and a cancelled customer keeps paid access. Resolve the
            // account the same way updateStoreSubscription does, so only a
            // customer that matches no account at all is skipped.
            const deletedAccount = await resolveAccountForSubscription(
              getDatabase(),
              customerSubscriptionDeleted,
              deletedCustomerId,
              normalizeEmail(
                'email' in customerDeleted ? customerDeleted.email : null
              )
            );
            if (!deletedAccount) {
              break;
            }

            await updateStoreSubscription(
              getDatabase(),
              customerDeleted as StripeTypes.Customer,
              customerSubscriptionDeleted
            );

            const deletedProductId =
              customerSubscriptionDeleted.items?.data?.[0]?.price?.product;
            const autoSyncProductIdForDelete = process.env.AUTO_SYNC_PRODUCT_ID;
            if (
              autoSyncProductIdForDelete != null &&
              deletedProductId === autoSyncProductIdForDelete
            ) {
              console.info('auto_sync.subscription.canceled', {
                subscription_status: 'deleted',
              });
            }
          }
          break;
        case 'checkout.session.completed': {
          const session: StripeTypes.Checkout.Session = event.data.object;
          const sessionMeta = (session.metadata ?? {}) as Record<
            string,
            string
          >;
          const passKind = sessionMeta.pass_kind as PassKind | undefined;

          const pricingVariant = sessionMeta.pricing_variant;
          const surface = sessionMeta.surface;
          const anonId = sessionMeta.anon_id;
          const userIdMeta = Number.parseInt(sessionMeta.user_id ?? '', 10);
          track('checkout_completed', {
            userId: Number.isNaN(userIdMeta) ? null : userIdMeta,
            anonymousId: anonId != null && anonId !== '' ? anonId : null,
            props: {
              plan:
                passKind ??
                (session.mode === 'subscription' ? 'subscription' : 'payment'),
              ...(pricingVariant != null && pricingVariant !== ''
                ? { variant: pricingVariant }
                : {}),
              ...(surface != null && surface !== '' ? { surface } : {}),
              ...(typeof session.recovered_from === 'string' &&
              session.recovered_from !== ''
                ? { recovered: true }
                : {}),
            },
          });

          if (passKind === '24h' || passKind === '7d') {
            const paymentIntentId =
              typeof session.payment_intent === 'string'
                ? session.payment_intent
                : null;
            const durationMs =
              passKind === '24h' ? DURATION_24H_MS : DURATION_7D_MS;
            const now = new Date();

            if (sessionMeta.pass_anonymous === '1') {
              if (paymentIntentId == null) {
                console.warn('pass.webhook.missing_metadata', {
                  pass_kind: passKind,
                  reason: 'no_payment_intent',
                  anonymous: true,
                });
                response.send();
                return;
              }
              try {
                const anonRepo = new AnonymousPassRepository(getDatabase());
                const expiresAt = new Date(now.getTime() + durationMs);
                const buyerEmail =
                  session.customer_details?.email ??
                  session.customer_email ??
                  null;
                const granted = await anonRepo.insert({
                  stripeSessionId: session.id,
                  kind: passKind,
                  expiresAt,
                  paymentIntentId,
                  buyerEmailHash:
                    buyerEmail == null ? null : emailHash(buyerEmail),
                });
                console.info('pass.granted.anonymous', {
                  kind: passKind,
                  expires_at: granted.expires_at.toISOString(),
                  payment_intent_id_hash: hashToken(paymentIntentId),
                });
              } catch (passError) {
                console.error('pass.webhook.grant_failed', passError);
              }
              response.send();
              return;
            }

            const rawUserId = sessionMeta.user_id;
            const passUserId =
              rawUserId == null ? Number.NaN : Number.parseInt(rawUserId, 10);
            if (Number.isNaN(passUserId) || passUserId <= 0) {
              console.warn('pass.webhook.missing_metadata', {
                raw_user_id: rawUserId,
                pass_kind: passKind,
              });
              response.send();
              return;
            }
            if (paymentIntentId == null) {
              console.warn('pass.webhook.missing_metadata', {
                user_id: passUserId,
                pass_kind: passKind,
                reason: 'no_payment_intent',
              });
              response.send();
              return;
            }
            try {
              const passRepo = new UserPassRepository(getDatabase());
              const granted = await passRepo.upsertWithExtension(
                passUserId,
                passKind,
                durationMs,
                paymentIntentId,
                now
              );
              console.info('pass.granted', {
                user_id: passUserId,
                kind: passKind,
                expires_at: granted.expires_at.toISOString(),
                payment_intent_id_hash: hashToken(paymentIntentId),
              });
            } catch (passError) {
              console.error('pass.webhook.grant_failed', passError);
            }
            response.send();
            return;
          }

          const amount = session.amount_total ?? 0;

          const LIFE_TIME_PRICE = 9600;
          const lifetimePriceIdsEnv = process.env.LIFETIME_PRICE_IDS ?? '';
          const lifetimePriceIds = lifetimePriceIdsEnv
            .split(',')
            .map((s) => s.trim())
            .filter((s) => s.length > 0);

          if (amount >= LIFE_TIME_PRICE) {
            try {
              const expandedSession = await stripe.checkout.sessions.retrieve(
                session.id,
                { expand: ['line_items'] }
              );
              const sessionPrice =
                expandedSession.line_items?.data?.[0]?.price ?? null;
              // price.product is a prod_ string because the price is not
              // expanded, but the allowlist is configured with the price ID.
              // Comparing against only one shape means a correct configuration
              // in the other shape never matches and the buyer stays on a free
              // account, so match either.
              const sessionPriceIds = [
                sessionPrice?.id,
                sessionPrice?.product,
              ].filter((value): value is string => typeof value === 'string');
              const isAllowlistedProduct = sessionPriceIds.some((value) =>
                lifetimePriceIds.includes(value)
              );

              if (isAllowlistedProduct) {
                const lifeTimeCustomer = await stripe.customers.retrieve(
                  // @ts-ignore: session.customer is string here; Stripe types allow string | Stripe.Customer | Stripe.DeletedCustomer
                  getCustomerId(session.customer)
                );
                const lifeTimeEmail =
                  'email' in lifeTimeCustomer ? lifeTimeCustomer.email : null;

                if (lifeTimeEmail == null) {
                  console.error(
                    `[webhook] checkout.session.completed: lifetime customer ${lifeTimeCustomer.id} has no email; quota not unlocked`
                  );
                } else {
                  const users = new UsersRepository(getDatabase());
                  const rowsAffected = await users.updatePatreonByEmail(
                    lifeTimeEmail,
                    true
                  );
                  if (rowsAffected === 0) {
                    await recordErrorUseCase.execute({
                      userId: null,
                      surface: 'stripe_provisioning',
                      code: 'unlinked_lifetime_payment',
                      context: {
                        email_hash: hashToken(lifeTimeEmail),
                        customer_id_hash: hashToken(lifeTimeCustomer.id),
                      },
                    });
                    console.error(
                      `[webhook] checkout.session.completed: no user row matched a lifetime purchase email (hash=${hashToken(
                        lifeTimeEmail
                      )}); quota NOT unlocked.`
                    );
                  } else {
                    console.info(
                      `[webhook] checkout.session.completed: unlocked lifetime access for email=${lifeTimeEmail} (${rowsAffected} row(s) updated)`
                    );
                  }
                }
              } else {
                // A payment this large that grants nothing is the failure the
                // lifetime alarm exists for, so it reports from here rather
                // than from inside the branch that only runs on a match.
                await recordErrorUseCase.execute({
                  userId: null,
                  surface: 'stripe_provisioning',
                  code: 'unmatched_high_value_payment',
                  context: {
                    amount_total: amount,
                    session_price_ids: sessionPriceIds,
                    allowlist_configured: lifetimePriceIds.length > 0,
                  },
                });
                console.error(
                  `[webhook] checkout.session.completed: session ${session.id} amount=${amount} matched no entry in LIFETIME_PRICE_IDS (candidates=${sessionPriceIds.join('|')}); no lifetime grant`
                );
              }
            } catch (error) {
              console.error(
                '[webhook] checkout.session.completed: failed to unlock lifetime access',
                error
              );
            }
          }

          try {
            const { sendPurchaseEvent } =
              await import('../services/GA4Service');
            await sendPurchaseEvent({
              transactionId: session.id,
              valueCents: session.amount_total ?? 0,
              currency: session.currency ?? 'usd',
              stripeCustomerId:
                typeof session.customer === 'string' ? session.customer : '',
              clientId: (session.metadata as Record<string, string> | null)
                ?.ga_client_id,
            });
          } catch (ga4Error) {
            console.error('[ga4] failed to send purchase event', ga4Error);
          }

          console.log('checkout.session.completed');
          break;
        }
        case 'checkout.session.expired': {
          const expiredSession = event.data.object as {
            id: string;
            customer_details?: { email?: string | null } | null;
            customer_email?: string | null;
            after_expiration?: {
              recovery?: {
                url?: string | null;
                expires_at?: number | null;
              } | null;
            } | null;
          };
          const sessionEmail =
            expiredSession.customer_details?.email ??
            expiredSession.customer_email ??
            null;
          const recoveryUrl =
            expiredSession.after_expiration?.recovery?.url ?? null;
          const recoveryExpiresAtSeconds =
            expiredSession.after_expiration?.recovery?.expires_at;
          const recoveryExpiresAt =
            recoveryExpiresAtSeconds == null
              ? null
              : new Date(recoveryExpiresAtSeconds * 1000);
          await abandonedCheckoutRecoveryUseCase.execute(
            expiredSession.id,
            sessionEmail,
            recoveryUrl == null
              ? null
              : { url: recoveryUrl, expiresAt: recoveryExpiresAt }
          );
          break;
        }
        default:
          console.log(`Unhandled event type ${event.type}`);
      }

      // Return a 200 response to acknowledge receipt of the event
      response.send();
    }
  );

  /**
   * @swagger
   * /successful-checkout:
   *   get:
   *     summary: Successful checkout page
   *     description: Display the successful checkout confirmation page after payment
   *     tags: [Payments]
   *     responses:
   *       200:
   *         description: Checkout success page rendered
   *         content:
   *           text/html:
   *             schema:
   *               type: string
   *               description: HTML success page
   */
  router.get('/successful-checkout', (req, res) =>
    controller.getSuccessfulCheckout(req, res)
  );

  /**
   * @swagger
   * /api/stripe/subscription-status:
   *   get:
   *     summary: Check user subscription status
   *     description: Check if the authenticated user has an active subscription
   *     tags: [Payments]
   *     responses:
   *       200:
   *         description: Subscription status information
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 authenticated:
   *                   type: boolean
   *                 hasActiveSubscription:
   *                   type: boolean
   *                 user:
   *                   type: object
   *                   properties:
   *                     email:
   *                       type: string
   *                     name:
   *                       type: string
   *                     patreon:
   *                       type: boolean
   *       401:
   *         description: Not authenticated
   *       500:
   *         description: Server error
   */
  router.get('/api/stripe/subscription-status', (req, res) =>
    controller.checkSubscriptionStatus(req, res)
  );

  return router;
};

export default WebhooksRouter;
