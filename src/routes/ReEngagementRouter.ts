import express from 'express';

import { ReEngagementController } from '../controllers/ReEngagementController';
import ReEngagementRepository from '../data_layer/ReEngagementRepository';
import EmailPreferencesRepository from '../data_layer/EmailPreferencesRepository';
import { getDatabase } from '../data_layer';

const ReEngagementRouter = () => {
  const router = express.Router();
  const database = getDatabase();
  const repo = new ReEngagementRepository(database);
  const prefRepo = new EmailPreferencesRepository(database);
  const controller = new ReEngagementController(repo, prefRepo);

  /**
   * @swagger
   * /feedback/onboarding:
   *   get:
   *     summary: Validate a re-engagement survey token
   *     tags: [Re-engagement]
   *     parameters:
   *       - in: query
   *         name: uid
   *         required: true
   *         schema:
   *           type: string
   *     responses:
   *       200:
   *         description: Token is valid
   *       400:
   *         description: uid missing
   *       404:
   *         description: Token not found
   */
  router.get('/feedback/onboarding', (req, res) =>
    controller.validateToken(req, res)
  );

  /**
   * @swagger
   * /feedback/onboarding:
   *   post:
   *     summary: Submit re-engagement survey feedback
   *     tags: [Re-engagement]
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             required: [token, stoppedReason, contentType]
   *             properties:
   *               token:
   *                 type: string
   *               stoppedReason:
   *                 type: string
   *               contentType:
   *                 type: string
   *               comment:
   *                 type: string
   *     responses:
   *       200:
   *         description: Feedback saved
   *       400:
   *         description: Missing required fields
   *       404:
   *         description: Token not found
   */
  router.post('/feedback/onboarding', (req, res) =>
    controller.submitFeedback(req, res)
  );

  /**
   * @swagger
   * /unsubscribe:
   *   get:
   *     summary: Unsubscribe from re-engagement emails
   *     tags: [Re-engagement]
   *     parameters:
   *       - in: query
   *         name: uid
   *         required: true
   *         schema:
   *           type: string
   *     responses:
   *       200:
   *         description: Successfully unsubscribed
   *       400:
   *         description: uid missing
   *       404:
   *         description: Token not found
   */
  router.get('/unsubscribe', (req, res) => controller.unsubscribe(req, res));

  return router;
};

export default ReEngagementRouter;
