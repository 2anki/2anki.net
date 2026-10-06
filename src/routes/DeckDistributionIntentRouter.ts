import express from 'express';

import DeckDistributionIntentController from '../controllers/DeckDistributionIntentController';
import { DeckDistributionIntentRepository } from '../data_layer/DeckDistributionIntentRepository';
import { getDatabase } from '../data_layer';
import RequireAuthentication from './middleware/RequireAuthentication';

const DeckDistributionIntentRouter = () => {
  const router = express.Router();
  const database = getDatabase();
  const repo = new DeckDistributionIntentRepository(database);
  const controller = new DeckDistributionIntentController(repo);

  /**
   * @swagger
   * /api/deck-distribution-intent:
   *   post:
   *     summary: Record interest in sharing a deck with an audience
   *     tags: [Feedback]
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             required: [answer, upload_key]
   *             properties:
   *               answer:
   *                 type: string
   *                 enum: [students, customers, study_group, colleagues, just_me]
   *               upload_key:
   *                 type: string
   *               notify_email:
   *                 type: string
   *     responses:
   *       201:
   *         description: Intent recorded
   *       400:
   *         description: Invalid input
   *       401:
   *         description: Authentication required
   */
  router.post(
    '/api/deck-distribution-intent',
    RequireAuthentication,
    (req, res) => controller.submit(req, res)
  );

  return router;
};

export default DeckDistributionIntentRouter;
