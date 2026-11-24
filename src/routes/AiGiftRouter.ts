import express, { type RequestHandler } from 'express';
import RequireAuthentication, {
  OptionalAuthentication,
} from './middleware/RequireAuthentication';
import { ipRateLimit } from './middleware/ipRateLimit';
import { AiGiftController } from '../controllers/AiGiftController';
import { getDatabase } from '../data_layer';
import { AiCreditGiftsRepository } from '../data_layer/AiCreditGiftsRepository';
import { AiUsageMetricsRepository } from '../data_layer/AiUsageMetricsRepository';
import { getFeatureFlag } from '../lib/featureFlags/getFeatureFlag';
import { AI_CREDITS_GIFT_FLAG } from '../lib/featureFlags/aiCreditsGift';
import {
  AI_GIFT_FEEDBACK_EVENT,
  cachedExposure,
  type AiGiftDeps,
} from '../usecases/ai/aiGift/aiGiftDeps';
import { GetAiGiftStatusUseCase } from '../usecases/ai/aiGift/GetAiGiftStatusUseCase';
import { ClaimAiGiftUseCase } from '../usecases/ai/aiGift/ClaimAiGiftUseCase';
import { RecordAiGiftFeedbackUseCase } from '../usecases/ai/aiGift/RecordAiGiftFeedbackUseCase';

const CLAIMS_PER_MINUTE_PER_IP = 5;
const FEEDBACK_PER_MINUTE_PER_IP = 10;

export interface AiGiftRouterOptions {
  deps?: AiGiftDeps;
  optionalAuth?: RequestHandler;
  requireAuth?: RequestHandler;
}

let defaultDeps: AiGiftDeps | null = null;

function productionDeps(): AiGiftDeps {
  if (defaultDeps != null) return defaultDeps;
  const database = getDatabase();
  const gifts = new AiCreditGiftsRepository(database);
  const usage = new AiUsageMetricsRepository(database);
  const exposure = cachedExposure((now) => gifts.exposureCredits(now));
  defaultDeps = {
    gifts,
    isEnabled: () => getFeatureFlag(AI_CREDITS_GIFT_FLAG, false),
    exposureCredits: exposure.exposureCredits,
    forgetExposure: exposure.forget,
    feedbackCount: (userId) =>
      usage.eventCountSince(AI_GIFT_FEEDBACK_EVENT, userId, new Date(0)),
    now: () => new Date(),
  };
  return defaultDeps;
}

const aiGiftRouter = (options: AiGiftRouterOptions = {}) => {
  const router = express.Router();
  const optionalAuth = options.optionalAuth ?? OptionalAuthentication;
  const requireAuth = options.requireAuth ?? RequireAuthentication;
  const depsFor = () => options.deps ?? productionDeps();
  const controller = () => {
    const deps = depsFor();
    return new AiGiftController(
      new GetAiGiftStatusUseCase(deps),
      new ClaimAiGiftUseCase(deps),
      new RecordAiGiftFeedbackUseCase(deps)
    );
  };

  /**
   * @swagger
   * /api/ai/gift:
   *   get:
   *     summary: State of the free AI credits gift for this visitor
   *     description: closed (switched off, ended, or this account's gift has expired), open (claimable), full (the gift budget is used for now) or claimed (this account's remaining gift credits and when they expire). feedbackDue is true once gift credits paid for a conversion and the account has not answered the one-question prompt.
   *     tags: [AI]
   *     responses:
   *       200:
   *         description: Gift state
   */
  router.get('/api/ai/gift', optionalAuth, (req, res) =>
    controller().getStatus(req, res)
  );

  /**
   * @swagger
   * /api/ai/gift/claim:
   *   post:
   *     summary: Claim the free AI credits gift
   *     description: One claim per account, at most three per network a day, while the gift is switched on and before claims close. Refusals answer with a code.
   *     tags: [AI]
   *     security:
   *       - bearerAuth: []
   *       - cookieAuth: []
   *     responses:
   *       200:
   *         description: Claimed; the credits and when they expire
   *       401:
   *         description: Authentication required
   *       409:
   *         description: gift_already_claimed or gift_budget_full
   *       410:
   *         description: gift_closed
   *       429:
   *         description: gift_ip_limit, or too many requests
   */
  router.post(
    '/api/ai/gift/claim',
    ipRateLimit(CLAIMS_PER_MINUTE_PER_IP),
    requireAuth,
    (req, res) => controller().claim(req, res)
  );

  /**
   * @swagger
   * /api/ai/gift/feedback:
   *   post:
   *     summary: Answer whether the gift-funded Claude cards came out as wanted
   *     description: Once per account that claimed the gift. answer is yes, no or dismissed; an optional comment (no answers only) is cut to 500 characters with all markup removed.
   *     tags: [AI]
   *     security:
   *       - bearerAuth: []
   *       - cookieAuth: []
   *     responses:
   *       204:
   *         description: Recorded
   *       400:
   *         description: invalid_answer
   *       403:
   *         description: no_gift
   *       409:
   *         description: already_answered
   */
  router.post(
    '/api/ai/gift/feedback',
    ipRateLimit(FEEDBACK_PER_MINUTE_PER_IP),
    requireAuth,
    (req, res) => controller().recordFeedback(req, res)
  );

  return router;
};

export default aiGiftRouter;
