import express from 'express';
import RequireAuthentication from './middleware/RequireAuthentication';
import { optionalAuthMiddleware } from './middleware/optionalAuthMiddleware';
import { RejectDuplicatePurchase } from './middleware/RejectDuplicatePurchase';
import { resolveStripeCustomer } from './middleware/ResolveStripeCustomer';
import AutoSyncCheckoutController from '../controllers/AutoSyncCheckoutController';
import AutoSyncPriceController from '../controllers/AutoSyncPriceController';
import { GetAutoSyncPriceUseCase } from '../usecases/checkout/GetAutoSyncPriceUseCase';
import PassCheckoutController from '../controllers/PassCheckoutController';
import CheckoutReceiptController from '../controllers/CheckoutReceiptController';
import { ipRateLimit } from './middleware/ipRateLimit';
import { GetCheckoutReceiptUseCase } from '../usecases/checkout/GetCheckoutReceiptUseCase';
import ResumeCheckoutController from '../controllers/ResumeCheckoutController';
import UnlimitedCheckoutController from '../controllers/UnlimitedCheckoutController';
import { AutoSyncCheckoutUseCase } from '../usecases/checkout/AutoSyncCheckoutUseCase';
import { CreatePassCheckoutUseCase } from '../usecases/checkout/CreatePassCheckoutUseCase';
import { CreateCreditPackCheckoutUseCase } from '../usecases/checkout/CreateCreditPackCheckoutUseCase';
import CreditPackCheckoutController from '../controllers/CreditPackCheckoutController';
import { ResumeAbandonedCheckoutUseCase } from '../usecases/checkout/ResumeAbandonedCheckoutUseCase';
import { UnlimitedCheckoutUseCase } from '../usecases/checkout/UnlimitedCheckoutUseCase';
import { StripeLapsedSubscriptions } from '../usecases/checkout/LapsedSubscriptions';
import { getStripe } from '../lib/integrations/stripe';
import { getDatabase } from '../data_layer';
import AbandonedCheckoutRecoveryRepository from '../data_layer/AbandonedCheckoutRecoveryRepository';
import { getEventsSink } from '../services/events/eventsSinkInstance';
import UsersRepository from '../data_layer/UsersRepository';
import { StripePriceResolver } from '../services/StripePriceResolver';
import { StripeCustomerResolver } from '../services/StripeCustomerResolver';
import { StaleCheckoutCustomerRefresher } from '../usecases/checkout/StaleCheckoutCustomerRefresher';
import { getPricingService } from '../services/pricingServiceInstance';
import { GetPassPricingUseCase } from '../usecases/checkout/GetPassPricingUseCase';
import PassPricingController from '../controllers/PassPricingController';
import PricingController from '../controllers/PricingController';

const DEFAULT_MAX_SUBSCRIBERS = 50;

const CheckoutRouter = () => {
  const router = express.Router();

  const staleCustomerRefresher = new StaleCheckoutCustomerRefresher(
    new UsersRepository(getDatabase()),
    new StripeCustomerResolver(getStripe(), new UsersRepository(getDatabase()))
  );

  const priceId = process.env.AUTO_SYNC_PRICE_ID ?? '';
  const productId = process.env.AUTO_SYNC_PRODUCT_ID ?? '';
  const maxSubscribers =
    Number.parseInt(process.env.HOSTED_ANKI_MAX_SUBSCRIBERS ?? '', 10) ||
    DEFAULT_MAX_SUBSCRIBERS;

  const autoSyncPrice = new GetAutoSyncPriceUseCase(getStripe(), priceId);

  /**
   * @swagger
   * /api/checkout/auto-sync/price:
   *   get:
   *     summary: Get the live Auto Sync price
   *     description: |
   *       Reads the Auto Sync price from Stripe so the pricing page shows what
   *       checkout charges. 404 when no active price is configured, which
   *       hides the offer.
   *     tags: [Payments]
   *     responses:
   *       200:
   *         description: Amount, currency, interval and display string
   *       404:
   *         description: Auto Sync is not on sale
   */
  router.get('/api/checkout/auto-sync/price', (req, res) =>
    new AutoSyncPriceController(autoSyncPrice).getPrice(req, res)
  );

  router.post(
    '/api/checkout/auto-sync',
    RequireAuthentication,
    express.json(),
    RejectDuplicatePurchase('auto_sync'),
    async (req, res) => {
      if (priceId === '') {
        return res
          .status(404)
          .json({ message: 'Auto Sync checkout is not available' });
      }
      await resolveStripeCustomer(res);
      const useCase = new AutoSyncCheckoutUseCase(
        getStripe(),
        priceId,
        productId,
        maxSubscribers,
        staleCustomerRefresher
      );
      const controller = new AutoSyncCheckoutController(useCase);
      return controller.createSession(req, res);
    }
  );

  const creditPackPriceId = process.env.CREDIT_PACK_PRICE_ID ?? '';

  router.post(
    '/api/checkout/credit-pack',
    RequireAuthentication,
    express.json(),
    async (req, res) => {
      if (creditPackPriceId === '') {
        return res
          .status(503)
          .json({ message: 'Credit packs are not available right now.' });
      }
      await resolveStripeCustomer(res);
      const useCase = new CreateCreditPackCheckoutUseCase(
        getStripe(),
        creditPackPriceId,
        staleCustomerRefresher
      );
      const controller = new CreditPackCheckoutController(useCase);
      return controller.createSession(req, res);
    }
  );

  const priceResolver = new StripePriceResolver(getStripe());
  const pricingService = getPricingService();

  router.post(
    '/api/checkout/unlimited',
    RequireAuthentication,
    express.json(),
    RejectDuplicatePurchase('subscription'),
    async (req, res) => {
      await resolveStripeCustomer(res);
      const useCase = new UnlimitedCheckoutUseCase(
        getStripe(),
        priceResolver,
        staleCustomerRefresher,
        new StripeLapsedSubscriptions(getStripe())
      );
      const controller = new UnlimitedCheckoutController(
        useCase,
        getEventsSink()
      );
      return controller.createSession(req, res);
    }
  );

  /**
   * @swagger
   * /api/checkout/prices:
   *   get:
   *     summary: Get the Pro plan prices
   *     description: |
   *       Returns the monthly and annual Pro prices every new checkout
   *       pays. The same for every visitor, signed in or not.
   *     tags: [Payments]
   *     responses:
   *       200:
   *         description: The v2 monthly and annual prices
   */
  router.get('/api/checkout/prices', (req, res) =>
    new PricingController().getPrices(req, res)
  );

  /**
   * @openapi
   * /api/checkout/receipt:
   *   get:
   *     summary: Amount, currency and kind of a paid Checkout Session the caller owns
   *     parameters:
   *       - in: query
   *         name: session_id
   *         required: true
   *         schema:
   *           type: string
   *     responses:
   *       200:
   *         description: Receipt for the success page's purchase conversion
   *       400:
   *         description: Malformed session id
   *       404:
   *         description: Unknown, unpaid or not the caller's session
   */
  const receiptRateLimit = ipRateLimit(30);
  router.get(
    '/api/checkout/receipt',
    receiptRateLimit,
    optionalAuthMiddleware,
    (req, res) =>
      new CheckoutReceiptController(
        new GetCheckoutReceiptUseCase(getStripe())
      ).getReceipt(req, res)
  );

  router.post(
    '/api/checkout/pass/24h',
    optionalAuthMiddleware,
    express.json(),
    RejectDuplicatePurchase('pass'),
    async (req, res) => {
      const pass24hPriceId = await pricingService.resolvePriceId('24h');
      if (pass24hPriceId == null) {
        return res
          .status(503)
          .json({ message: 'Day Pass is not available right now.' });
      }
      await resolveStripeCustomer(res);
      const useCase = new CreatePassCheckoutUseCase(
        getStripe(),
        pass24hPriceId,
        '24h',
        staleCustomerRefresher
      );
      const controller = new PassCheckoutController(
        useCase,
        '24h',
        getEventsSink()
      );
      return controller.createSession(req, res);
    }
  );

  router.post(
    '/api/checkout/pass/7d',
    optionalAuthMiddleware,
    express.json(),
    RejectDuplicatePurchase('pass'),
    async (req, res) => {
      const pass7dPriceId = await pricingService.resolvePriceId('7d');
      if (pass7dPriceId == null) {
        return res
          .status(503)
          .json({ message: 'Week Pass is not available right now.' });
      }
      await resolveStripeCustomer(res);
      const useCase = new CreatePassCheckoutUseCase(
        getStripe(),
        pass7dPriceId,
        '7d',
        staleCustomerRefresher
      );
      const controller = new PassCheckoutController(
        useCase,
        '7d',
        getEventsSink()
      );
      return controller.createSession(req, res);
    }
  );

  router.post(
    '/api/checkout/pass/120d',
    optionalAuthMiddleware,
    express.json(),
    RejectDuplicatePurchase('pass'),
    async (req, res) => {
      const pass120dPriceId = await pricingService.resolvePriceId('120d');
      if (pass120dPriceId == null) {
        return res
          .status(503)
          .json({ message: 'Semester Pass is not available right now.' });
      }
      await resolveStripeCustomer(res);
      const useCase = new CreatePassCheckoutUseCase(
        getStripe(),
        pass120dPriceId,
        '120d',
        staleCustomerRefresher
      );
      const controller = new PassCheckoutController(
        useCase,
        '120d',
        getEventsSink()
      );
      return controller.createSession(req, res);
    }
  );

  /**
   * @swagger
   * /api/pricing:
   *   get:
   *     summary: Get the current one-time pass prices
   *     description: |
   *       Returns the live amount, currency, and formatted display string for
   *       each pass kind (24h, 7d, 120d), resolved from Stripe by price
   *       metadata so the displayed price can never diverge from the amount
   *       charged at checkout. Public and cacheable; a pass whose amount cannot
   *       be resolved from Stripe is omitted so the client keeps its fallback.
   *     tags: [Payments]
   *     responses:
   *       200:
   *         description: Amount, currency, and display string per pass kind
   */
  router.get('/api/pricing', (req, res) => {
    const useCase = new GetPassPricingUseCase(pricingService);
    const controller = new PassPricingController(useCase);
    return controller.getPassPricing(req, res);
  });

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
