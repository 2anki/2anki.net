import express from 'express';
import multer from 'multer';

import IndexController from '../controllers/IndexController/IndexController';
import { ensureIsLoggedIn } from './middleware/ensureIsLoggedIn';
import { isKnownAppRoute } from './knownRoutes';
import { normalizeUploadFilenames } from './middleware/normalizeUploadFilenames';
import { sessionAuthService } from './middleware/optionalAuthMiddleware';
import { ConnectorArrivalController } from '../controllers/ConnectorArrivalController';
import {
  RecordConnectorArrivalUseCase,
  type SessionResolver,
} from '../usecases/mcp/RecordConnectorArrivalUseCase';

const upload = multer({
  limits: { fileSize: 25 * 1024 * 1024 },
  dest: process.env.FEEDBACK_DIR || '~/',
});

const contactUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
});

const DefaultRouter = (
  sessions: () => SessionResolver = sessionAuthService
) => {
  const controller = new IndexController();
  const connectorArrival = new ConnectorArrivalController(
    () => new RecordConnectorArrivalUseCase(sessions())
  );
  const router = express.Router();

  /**
   * @swagger
   * /index.html:
   *   get:
   *     summary: Get main application page
   *     description: Serve the main application index page
   *     tags: [Frontend]
   *     responses:
   *       200:
   *         description: Main application page rendered
   *         content:
   *           text/html:
   *             schema:
   *               type: string
   *               description: HTML application page
   */
  router.get('/index.html', (req, res) => controller.getIndex(req, res));

  /**
   * @swagger
   * /search:
   *   get:
   *     summary: Search page (authenticated)
   *     description: Access the search functionality (requires authentication)
   *     tags: [Frontend]
   *     security:
   *       - bearerAuth: []
   *       - cookieAuth: []
   *     responses:
   *       200:
   *         description: Search page rendered for authenticated user
   *         content:
   *           text/html:
   *             schema:
   *               type: string
   *               description: HTML search page
   *       401:
   *         description: Authentication required
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/Error'
   */
  router.get(['/notion', '/search'], async (req, res) => {
    const isLoggedIn = await ensureIsLoggedIn(req, res);
    if (!isLoggedIn) {
      return;
    }
    controller.getIndex(req, res);
  });

  /**
   * @swagger
   * /pricing:
   *   get:
   *     summary: Plans page
   *     description: Serves the plans page. A visit through the connector's plans link (ref=mcp) is counted once the response is sent; the response itself is the plain page.
   *     tags: [Frontend]
   *     parameters:
   *       - in: query
   *         name: ref
   *         required: false
   *         schema:
   *           type: string
   *         description: mcp for the connector's plans link
   *       - in: query
   *         name: k
   *         required: false
   *         schema:
   *           type: string
   *           enum: [partial, held, limit]
   *         description: The limit result that showed the link
   *       - in: query
   *         name: a
   *         required: false
   *         schema:
   *           type: string
   *           enum: [a, b]
   *         description: The copy arm of the limit message
   *       - in: query
   *         name: held_until
   *         required: false
   *         schema:
   *           type: string
   *           format: date
   *         description: The day a deck saved for a plan expires
   *     responses:
   *       200:
   *         description: Plans page rendered
   *         content:
   *           text/html:
   *             schema:
   *               type: string
   */
  router.get('/pricing', (req, res, next) => {
    connectorArrival.recordAfterResponse(req, res);
    next();
  });

  router.get('/documentation/api/docs', (_req, res) => {
    res.redirect(301, '/documentation/reference/mcp/');
  });

  /**
   * @swagger
   * /{path}:
   *   get:
   *     summary: Catch-all frontend routes
   *     description: Serve the main application for all non-API routes (SPA routing)
   *     tags: [Frontend]
   *     parameters:
   *       - in: path
   *         name: path
   *         required: false
   *         schema:
   *           type: string
   *         description: Any non-API path
   *     responses:
   *       200:
   *         description: Main application page for SPA routing
   *         content:
   *           text/html:
   *             schema:
   *               type: string
   *               description: HTML application page
   */
  router.get(/^\/(?!api).*/, (req, res) => {
    if (!isKnownAppRoute(req.path)) {
      res.status(404);
    }
    controller.getIndex(req, res);
  });

  /**
   * @swagger
   * /api/contact-us:
   *   post:
   *     summary: Contact us form
   *     description: Submit a contact form with optional file attachments
   *     tags: [Support]
   *     requestBody:
   *       required: true
   *       content:
   *         multipart/form-data:
   *           schema:
   *             type: object
   *             required:
   *               - name
   *               - email
   *               - message
   *             properties:
   *               name:
   *                 type: string
   *                 description: Sender's name
   *               email:
   *                 type: string
   *                 format: email
   *                 description: Sender's email address
   *               message:
   *                 type: string
   *                 description: Contact message
   *               subject:
   *                 type: string
   *                 description: Message subject
   *               attachments:
   *                 type: array
   *                 items:
   *                   type: string
   *                   format: binary
   *                 description: Optional file attachments (max 25MB per file)
   *     responses:
   *       200:
   *         description: Contact form submitted successfully
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/Success'
   *       400:
   *         description: Invalid form data or file too large
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/Error'
   *       500:
   *         description: Failed to send contact message
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/Error'
   */
  router.post(
    '/api/contact-us',
    contactUpload.array('attachments'),
    normalizeUploadFilenames,
    (req, res) => controller.contactUs(req, res)
  );

  return router;
};

export default DefaultRouter;
