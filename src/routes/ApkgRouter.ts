import express from 'express';
import multer from 'multer';

import RequireAuthentication from './middleware/RequireAuthentication';
import { acceptKeyOr } from './middleware/RequireApiKey';
import RequireAllowedOrigin from './middleware/RequireAllowedOrigin';
import { printQuotaMiddleware } from './middleware/PrintQuotaMiddleware';
import ApkgController from '../controllers/ApkgController';
import ApkgPreviewService from '../services/ApkgPreviewService/ApkgPreviewService';
import DownloadService from '../services/DownloadService';
import DownloadRepository from '../data_layer/DownloadRepository';
import JobRepository from '../data_layer/JobRepository';
import NotionRepository from '../data_layer/NotionRespository';
import BlocksCacheRepository from '../data_layer/BlocksCacheRepository';
import UsersRepository from '../data_layer/UsersRepository';
import { NotionService } from '../services/NotionService/NotionService';
import { getDatabase } from '../data_layer';

const ApkgRouter = () => {
  const database = getDatabase();
  const downloadService = new DownloadService(new DownloadRepository(database));
  const previewService = new ApkgPreviewService();
  const notionService = new NotionService(
    new NotionRepository(database),
    undefined,
    new BlocksCacheRepository(database)
  );
  const jobRepository = new JobRepository(database);
  const usersRepository = new UsersRepository(database);
  const controller = new ApkgController(
    downloadService,
    previewService,
    undefined,
    notionService,
    jobRepository
  );
  const router = express.Router();

  /**
   * @swagger
   * /api/apkg/{key}/meta:
   *   get:
   *     summary: Get .apkg preview metadata
   *     description: Returns the total card count and the list of decks (with card counts) for a user-owned .apkg upload.
   *     tags: [Apkg Preview]
   *     security:
   *       - bearerAuth: []
   *       - cookieAuth: []
   *     parameters:
   *       - in: path
   *         name: key
   *         required: true
   *         schema:
   *           type: string
   *         description: S3 object key of the upload
   *     responses:
   *       200:
   *         description: Preview metadata
   *       400:
   *         description: Not an .apkg upload
   *       401:
   *         description: Authentication required
   *       404:
   *         description: Upload not found
   */
  router.get(
    '/api/apkg/:key/meta',
    acceptKeyOr(RequireAuthentication),
    (req, res) => controller.getMeta(req, res)
  );

  /**
   * @swagger
   * /api/apkg/{key}/cards:
   *   get:
   *     summary: Get a page of rendered .apkg cards
   *     description: Returns a paginated, server-rendered (sanitised HTML + note-type CSS) slice of the deck. Optionally filtered by deck id.
   *     tags: [Apkg Preview]
   *     security:
   *       - bearerAuth: []
   *       - cookieAuth: []
   *     parameters:
   *       - in: path
   *         name: key
   *         required: true
   *         schema:
   *           type: string
   *         description: S3 object key of the upload
   *       - in: query
   *         name: cursor
   *         schema:
   *           type: integer
   *         description: Zero-based index to resume from; omit for the first page.
   *       - in: query
   *         name: page_size
   *         schema:
   *           type: integer
   *         description: Number of cards per page (1–100, default 20).
   *       - in: query
   *         name: deck_id
   *         schema:
   *           type: integer
   *         description: Restrict to cards belonging to this deck id.
   *     responses:
   *       200:
   *         description: Rendered cards page
   *       400:
   *         description: Not an .apkg upload
   *       401:
   *         description: Authentication required
   *       404:
   *         description: Upload not found
   */
  router.get(
    '/api/apkg/:key/cards',
    acceptKeyOr(RequireAuthentication),
    (req, res) => controller.getCards(req, res)
  );

  /**
   * @swagger
   * /api/apkg/{key}/media/{name}:
   *   get:
   *     summary: Serve a media file bundled inside an .apkg upload
   *     description: Streams bytes for the named file (by its original filename from the media manifest) with a best-effort Content-Type.
   *     tags: [Apkg Preview]
   *     security:
   *       - bearerAuth: []
   *       - cookieAuth: []
   *     parameters:
   *       - in: path
   *         name: key
   *         required: true
   *         schema:
   *           type: string
   *         description: S3 object key of the upload
   *       - in: path
   *         name: name
   *         required: true
   *         schema:
   *           type: string
   *         description: Original filename as referenced by the card content
   *     responses:
   *       200:
   *         description: File bytes
   *         content:
   *           application/octet-stream:
   *             schema:
   *               type: string
   *               format: binary
   *       401:
   *         description: Authentication required
   *       404:
   *         description: Media not found in archive
   */
  router.get('/api/apkg/:key/media/:name', RequireAuthentication, (req, res) =>
    controller.getMedia(req, res)
  );

  /**
   * @swagger
   * /api/apkg/{key}/download-edited:
   *   post:
   *     summary: Download an .apkg with user edits applied
   *     description: Re-packs the source .apkg with the provided edit set — text edits, card deletions, and suspend flags — and returns the modified file for download.
   *     tags: [Apkg Preview]
   *     security:
   *       - bearerAuth: []
   *       - cookieAuth: []
   *     parameters:
   *       - in: path
   *         name: key
   *         required: true
   *         schema:
   *           type: string
   *         description: S3 object key of the upload
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             required: [edits]
   *             properties:
   *               edits:
   *                 type: array
   *                 items:
   *                   type: object
   *                   required: [cardIndex]
   *                   properties:
   *                     cardIndex:
   *                       type: integer
   *                     front:
   *                       type: string
   *                     back:
   *                       type: string
   *                     deleted:
   *                       type: boolean
   *                     suspended:
   *                       type: boolean
   *     responses:
   *       200:
   *         description: Modified .apkg file
   *         content:
   *           application/octet-stream:
   *             schema:
   *               type: string
   *               format: binary
   *       400:
   *         description: Not an .apkg upload or invalid edits
   *       401:
   *         description: Authentication required
   *       404:
   *         description: Upload not found
   */
  router.post(
    '/api/apkg/:key/download-edited',
    RequireAuthentication,
    (req, res) => controller.downloadEdited(req, res)
  );

  const importUpload = multer({
    dest: process.env.UPLOAD_BASE ?? '/tmp',
    limits: { fileSize: 100 * 1024 * 1024 },
  });

  router.post(
    '/api/apkg/import',
    RequireAllowedOrigin,
    RequireAuthentication,
    importUpload.single('file'),
    (req, res) => controller.importToNotion(req, res)
  );

  router.get(
    '/api/apkg/import/:jobId/status',
    RequireAuthentication,
    (req, res) => controller.getImportStatus(req, res)
  );

  const pdfUpload = multer({
    dest: process.env.UPLOAD_BASE ?? '/tmp',
    limits: { fileSize: 100 * 1024 * 1024 },
  });

  router.post(
    '/api/apkg/pdf',
    RequireAllowedOrigin,
    RequireAuthentication,
    printQuotaMiddleware(usersRepository),
    pdfUpload.single('file'),
    (req, res) => controller.exportPdf(req, res)
  );

  const csvUpload = multer({
    dest: process.env.UPLOAD_BASE ?? '/tmp',
    limits: { fileSize: 100 * 1024 * 1024 },
  });

  // No RequireAuthentication: anonymous visitors get a capped export. This is
  // the landing page for "export anki deck to csv" search traffic, and a 401
  // after the file picker spent their intent for nothing. RequireAllowedOrigin
  // already populates res.locals, so the controller can still read the tier.
  router.post(
    '/api/apkg/csv',
    RequireAllowedOrigin,
    csvUpload.single('file'),
    (req, res) => controller.exportCsv(req, res)
  );

  return router;
};

export default ApkgRouter;
