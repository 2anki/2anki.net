import express from 'express';

import EmojiFeedbackController from '../controllers/EmojiFeedbackController';
import { EmojiFeedbackRepository } from '../data_layer/EmojiFeedbackRepository';
import { LowRatingContextRepository } from '../data_layer/LowRatingContextRepository';
import JobRepository from '../data_layer/JobRepository';
import UploadRepository from '../data_layer/UploadRespository';
import { getDatabase } from '../data_layer';
import { getDefaultEmailService } from '../services/EmailService/EmailService';
import { NotifyLowRatingUseCase } from '../usecases/feedback/NotifyLowRatingUseCase';
import { ResolveRatedConversionUseCase } from '../usecases/feedback/ResolveRatedConversionUseCase';
import { InMemoryRateLimiter } from '../lib/rateLimit/InMemoryRateLimiter';
import { optionalAuthMiddleware } from './middleware/optionalAuthMiddleware';

const HOUR_MS = 60 * 60 * 1000;
const NOTIFICATIONS_PER_IP_PER_HOUR = 5;
const NOTIFICATIONS_PER_HOUR = 30;

const EmojiFeedbackRouter = () => {
  const router = express.Router();
  const database = getDatabase();
  const repo = new EmojiFeedbackRepository(database);
  const notificationLimiter = new InMemoryRateLimiter({
    windowMs: HOUR_MS,
    perKeyMax: NOTIFICATIONS_PER_IP_PER_HOUR,
    globalMax: NOTIFICATIONS_PER_HOUR,
  });
  const notifier = new NotifyLowRatingUseCase(
    repo,
    new LowRatingContextRepository(database),
    getDefaultEmailService(),
    notificationLimiter
  );
  const conversionResolver = new ResolveRatedConversionUseCase(
    new JobRepository(database),
    new UploadRepository(database)
  );
  const controller = new EmojiFeedbackController(
    repo,
    notifier,
    conversionResolver
  );

  /**
   * @swagger
   * /api/emoji-feedback:
   *   post:
   *     summary: Submit emoji feedback
   *     tags: [Feedback]
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             required: [rating, page]
   *             properties:
   *               rating:
   *                 type: integer
   *                 minimum: 1
   *                 maximum: 5
   *               comment:
   *                 type: string
   *               email:
   *                 type: string
   *               page:
   *                 type: string
   *               job_id:
   *                 type: integer
   *               upload_id:
   *                 type: integer
   *               input_format:
   *                 type: string
   *     responses:
   *       201:
   *         description: Feedback saved
   *       400:
   *         description: Invalid input
   */
  router.post('/api/emoji-feedback', optionalAuthMiddleware, (req, res) =>
    controller.submit(req, res)
  );

  /**
   * @swagger
   * /api/emoji-feedback/{id}:
   *   patch:
   *     summary: Add a comment and reply email to a rating saved earlier
   *     tags: [Feedback]
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema:
   *           type: integer
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             required: [token]
   *             properties:
   *               token:
   *                 type: string
   *                 description: Returned when the rating was saved
   *               comment:
   *                 type: string
   *               email:
   *                 type: string
   *     responses:
   *       200:
   *         description: Follow-up saved
   *       400:
   *         description: Invalid input
   *       403:
   *         description: Token does not match the rating
   */
  router.patch('/api/emoji-feedback/:id', optionalAuthMiddleware, (req, res) =>
    controller.followUp(req, res)
  );

  return router;
};

export default EmojiFeedbackRouter;
