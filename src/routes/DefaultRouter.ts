import express from 'express';
import multer from 'multer';

import IndexController from '../controllers/IndexController/IndexController';
import { ensureIsLoggedIn } from './middleware/ensureIsLoggedIn';
import { isKnownAppRoute } from './knownRoutes';
import { normalizeUploadFilenames } from './middleware/normalizeUploadFilenames';

const upload = multer({
  limits: { fileSize: 25 * 1024 * 1024 },
  dest: process.env.FEEDBACK_DIR || '~/',
});

const contactUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
});

const DefaultRouter = () => {
  const controller = new IndexController();
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
