import express from 'express';
import RequireAuthentication from './middleware/RequireAuthentication';
import { optionalAuthMiddleware } from './middleware/optionalAuthMiddleware';
import AutoSyncCheckoutController from '../controllers/AutoSyncCheckoutController';
import PassCheckoutController from '../controllers/PassCheckoutController';
import ResumeCheckoutController from '../controllers/ResumeCheckoutController';
import UnlimitedCheckoutController from '../controllers/UnlimitedCheckoutController';
import { AutoSyncCheckoutUseCase } from '../usecases/checkout/AutoSyncCheckoutUseCase';
import { CreatePassCheckoutUseCase } from '../usecases/checkout/CreatePassCheckoutUseCase';
import { ResumeAbandonedCheckoutUseCase } from '../usecases/checkout/ResumeAbandonedCheckoutUseCase';
import { UnlimitedCheckoutUseCase } from '../usecases/checkout/UnlimitedCheckoutUseCase';
import { getStripe } from '../lib/integrations/stripe';
import { getDatabase } from '../data_layer';
import AbandonedCheckoutRecoveryRepository from '../data_layer/AbandonedCheckoutRecoveryRepository';
import { getEventsSink } from '../services/events/eventsSinkInstance';
import { FeatureFlagsRepository } from '../data_layer/FeatureFlagsRepository';
import UsersRepository from '../data_layer/UsersRepository';
import { StripePriceResolver } from '../services/StripePriceResolver';
import { PRICING_V2_FLAG } from '../usecases/checkout/pricingV2';
import PricingController from '../controllers/PricingController';

const DEFAULT_MAX_SUBSCRIBERS = 50;

const toCreatedAt = (value: unknown): Date | null => {
  if (value == null) return null;
  if (value instanceof Date) return value;
  if (typeof value === 'string' || typeof value === 'number') {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  return null;
};

const resolvePricingV2Flag = async (): Promise<boolean> => {
  const repo = new FeatureFlagsRepository(getDatabase());
  return (await repo.get(PRICING_V2_FLAG)) === true;
};

const getUserCreatedAt = async (userId: number): Promise<Date | null> => {
  const repo = new UsersRepository(getDatabase());
  const user = await repo.getById(String(userId));
  return toCreatedAt(
    (user as { created_at?: unknown } | undefined)?.created_at
  );
};

const CheckoutRouter = () => {
  const router = express.Router();

  const priceId = process.env.AUTO_SYNC_PRICE_ID ?? '';
  const productId = process.env.AUTO_SYNC_PRODUCT_ID ?? '';
  const maxSubscribers =
    Number.parseInt(process.env.HOSTED_ANKI_MAX_SUBSCRIBERS ?? '', 10) ||
    DEFAULT_MAX_SUBSCRIBERS;

  router.post(
    '/api/checkout/auto-sync',
    RequireAuthentication,
    express.json(),
    (req, res) => {
      if (priceId === '') {
        return res
          .status(404)
          .json({ message: 'Auto Sync checkout is not available' });
      }
      const useCase = new AutoSyncCheckoutUseCase(
        getStripe(),
        priceId,
        productId,
        maxSubscribers
      );
      const controller = new AutoSyncCheckoutController(useCase);
      return controller.createSession(req, res);
    }
  );

  const unlimitedMonthlyPriceId = process.env.UNLIMITED_MONTHLY_PRICE_ID ?? '';
  const unlimitedYearlyPriceId = process.env.UNLIMITED_YEARLY_PRICE_ID ?? '';
  const priceResolver = new StripePriceResolver(getStripe());

  router.post(
    '/api/checkout/unlimited',
    RequireAuthentication,
    express.json(),
    async (req, res) => {
      if (unlimitedMonthlyPriceId === '') {
        return res
          .status(503)
          .json({ message: 'Unlimited checkout is not available' });
      }
      const useCase = new UnlimitedCheckoutUseCase(
        getStripe(),
        unlimitedMonthlyPriceId,
        unlimitedYearlyPriceId,
        priceResolver
      );
      const controller = new UnlimitedCheckoutController(
        useCase,
        { pricingV2On: await resolvePricingV2Flag(), getUserCreatedAt },
        getEventsSink()
      );
      return controller.createSession(req, res);
    }
  );

  /**
   * @swagger
   * /api/checkout/prices:
   *   get:
   *     summary: Get the Unlimited plan prices for the current visitor
   *     description: |
   *       Returns the monthly and annual Unlimited prices the visitor would
   *       pay at checkout. Accounts created before the pricing-v2 cutover see
   *       legacy prices until the lock-in window closes; everyone else sees
   *       v2 prices once the pricing_v2 flag is on. Anonymous visitors are
   *       always quoted the new-member prices.
   *     tags: [Payments]
   *     responses:
   *       200:
   *         description: Effective prices and lock-in window for the visitor
   */
  router.get(
    '/api/checkout/prices',
    optionalAuthMiddleware,
    async (_req, res) => {
      const controller = new PricingController({
        pricingV2On: await resolvePricingV2Flag(),
        getUserCreatedAt,
      });
      return controller.getPrices(_req, res);
    }
  );

  router.post(
    '/api/checkout/pass/24h',
    optionalAuthMiddleware,
    express.json(),
    (req, res) => {
      const pass24hPriceId = process.env.PASS_24H_PRICE_ID ?? '';
      if (pass24hPriceId === '') {
        return res
          .status(503)
          .json({ message: 'Day Pass is not available right now.' });
      }
      const useCase = new CreatePassCheckoutUseCase(
        getStripe(),
        pass24hPriceId,
        '24h'
      );
      const controller = new PassCheckoutController(useCase);
      return controller.createSession(req, res);
    }
  );

  router.post(
    '/api/checkout/pass/7d',
    optionalAuthMiddleware,
    express.json(),
    (req, res) => {
      const pass7dPriceId = process.env.PASS_7D_PRICE_ID ?? '';
      if (pass7dPriceId === '') {
        return res
          .status(503)
          .json({ message: 'Week Pass is not available right now.' });
      }
      const useCase = new CreatePassCheckoutUseCase(
        getStripe(),
        pass7dPriceId,
        '7d'
      );
      const controller = new PassCheckoutController(useCase);
      return controller.createSession(req, res);
    }
  );

  /**
   * @swagger
   * /checkout/resume:
   *   get:
   *     summary: Resume an abandoned Stripe checkout
   *     description: |
   *       Redirects the recovery-email recipient back to their expired Stripe
   *       Checkout session via the Stripe-hosted recovery URL. The token is the
   *       single-use UUID minted when the recovery email was sent. Unknown,
   *       malformed, or expired tokens fall back to the pricing page — the
   *       endpoint never fails user-visibly.
   *     tags: [Payments]
   *     parameters:
   *       - in: query
   *         name: token
   *         schema:
   *           type: string
   *           format: uuid
   *         description: Recovery token from the abandoned-checkout email
   *     responses:
   *       302:
   *         description: Redirect to the Stripe recovery URL or to /pricing
   */
  router.get('/checkout/resume', (req, res) => {
    const useCase = new ResumeAbandonedCheckoutUseCase(
      new AbandonedCheckoutRecoveryRepository(getDatabase())
    );
    const controller = new ResumeCheckoutController(useCase, getEventsSink());
    return controller.resume(req, res);
  });

  return router;
};

export default CheckoutRouter;
