import express from 'express';
import RequireAuthentication from './middleware/RequireAuthentication';
import PitchDismissalsRepository from '../data_layer/PitchDismissalsRepository';
import JobRepository from '../data_layer/JobRepository';
import { DismissPitchUseCase } from '../usecases/pitches/DismissPitchUseCase';
import { ShouldShowAutoSyncPitchUseCase } from '../usecases/pitches/ShouldShowAutoSyncPitchUseCase';
import { PitchController } from '../controllers/PitchController';
import { getDatabase } from '../data_layer';

const PitchRouter = () => {
  const router = express.Router();
  const database = getDatabase();
  const dismissalRepo = new PitchDismissalsRepository(database);
  const jobRepo = new JobRepository(database);
  const dismissUseCase = new DismissPitchUseCase(dismissalRepo);
  const shouldShowUseCase = new ShouldShowAutoSyncPitchUseCase(
    jobRepo,
    dismissalRepo,
    process.env.AUTO_SYNC_PRODUCT_ID ?? ''
  );
  const controller = new PitchController(dismissUseCase, shouldShowUseCase);

  /**
   * @swagger
   * /api/pitches/dismiss:
   *   post:
   *     summary: Dismiss an Auto Sync pitch placement
   *     tags: [Pitches]
   *     security:
   *       - cookieAuth: []
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             required: [placement]
   *             properties:
   *               placement:
   *                 type: string
   *                 enum: [convert_success, account_banner, producer_prompt, post_download_nudge]
   *     responses:
   *       204:
   *         description: Dismissal recorded
   *       400:
   *         description: Invalid placement value
   *       401:
   *         description: Not authenticated
   */
  router.post('/api/pitches/dismiss', RequireAuthentication, (req, res) =>
    controller.dismiss(req, res)
  );

  /**
   * @swagger
   * /api/pitches/auto-sync:
   *   get:
   *     summary: Check Auto Sync pitch eligibility for a user
   *     tags: [Pitches]
   *     security:
   *       - cookieAuth: []
   *     parameters:
   *       - in: query
   *         name: objectId
   *         schema:
   *           type: string
   *         description: Notion object ID for re-upload detection
   *       - in: query
   *         name: jobType
   *         schema:
   *           type: string
   *         description: Job type (page or database for Notion)
   *     responses:
   *       200:
   *         description: Pitch eligibility result
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 convertSuccess:
   *                   type: boolean
   *                 accountBanner:
   *                   type: boolean
   *       401:
   *         description: Not authenticated
   */
  router.get('/api/pitches/auto-sync', RequireAuthentication, (req, res) =>
    controller.autoSyncEligibility(req, res)
  );

  return router;
};

export default PitchRouter;
