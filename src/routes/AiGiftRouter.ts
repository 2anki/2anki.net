import express, { type RequestHandler } from 'express';
import RequireAuthentication, {
  OptionalAuthentication,
} from './middleware/RequireAuthentication';
import { ipRateLimit } from './middleware/ipRateLimit';
import { AiGiftController } from '../controllers/AiGiftController';
import { getDatabase } from '../data_layer';
import { AiCreditGiftsRepository } from '../data_layer/AiCreditGiftsRepository';
import { getFeatureFlag } from '../lib/featureFlags/getFeatureFlag';
import { AI_CREDITS_GIFT_FLAG } from '../lib/featureFlags/aiCreditsGift';
import {
  cachedExposure,
  createClaudeDefaultStatusReaders,
  type AiGiftDeps,
} from '../usecases/ai/aiGift/aiGiftDeps';
import { GetAiGiftStatusUseCase } from '../usecases/ai/aiGift/GetAiGiftStatusUseCase';
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
  const exposure = cachedExposure((now) => gifts.exposureCredits(now));
  defaultDeps = {
    gifts,
    isEnabled: () => getFeatureFlag(AI_CREDITS_GIFT_FLAG, false),
    exposureCredits: exposure.exposureCredits,
    forgetExposure: exposure.forget,
    now: () => new Date(),
    claudeDefault: createClaudeDefaultStatusReaders(database),
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
      new RecordAiGiftFeedbackUseCase(deps)
    );
  };

  /**
   * @swagger
   * /api/ai/gift:
   *   get:
   *     summary: State of the free AI credits gift for this visitor
   *     description: closed (switched off, ended, a paying account without a grant, or this account's grant has expired), open (no grant yet; the whole amount), full (the gift total, or this network's daily limit, is used for now) or claimed (this account's grant, made at its first upload the gift pays for). hasCredits is whether this account's next upload would run on gift credits (false when signed out). A grant lasts validDays from its first AI call and never past endsAt; firstUsed (claimed only) says whether that clock has started, and expiresAt is the grant's end so far. feedbackDue is true once gift credits paid for a conversion and the account has not answered the one-question prompt. inUse (claimed only) is true while one of this account's conversions holds the gift. minMonthlyCards is how many cards the month must have left for a gift-only upload to reach Claude. For a signed-in account, claudeDefaultForPdf is whether the upload's Claude default rule would turn Claude on for its next web upload of an input Claude cards read; aiBudgetAvailable is whether an AI upload would have budget in the wallet it would use; storedPdfSkipsClaude is whether the account's saved options keep a PDF from Claude (all null when unknown); monthlyCardsLeft is the month's cards left (null when unknown).
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
   *     summary: Former claim step, kept for pages opened before it went
   *     description: Stores nothing. Answers with the same body as GET /api/ai/gift for this account; a grant is now made at the account's first upload the gift pays for.
   *     tags: [AI]
   *     security:
   *       - bearerAuth: []
   *       - cookieAuth: []
   *     responses:
   *       200:
   *         description: The account's gift status
   *       401:
   *         description: Authentication required
   *       429:
   *         description: Too many requests
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
