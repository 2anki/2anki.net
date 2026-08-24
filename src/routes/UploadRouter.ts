import express from 'express';
import multer from 'multer';
import path from 'path';

import RequireAllowedOrigin from './middleware/RequireAllowedOrigin';
import RequireAuthentication from './middleware/RequireAuthentication';
import RequirePayingJson from './middleware/RequirePayingJson';
import { normalizeUploadFilenames } from './middleware/normalizeUploadFilenames';
import UploadController from '../controllers/Upload/UploadController';
import { SaveNativeDeckController } from '../controllers/Upload/SaveNativeDeckController';
import { SaveNativeDeckUseCase } from '../usecases/uploads/SaveNativeDeckUseCase';
import StorageHandler from '../lib/storage/StorageHandler';
import JobController from '../controllers/JobController';
import JobService from '../services/JobService';
import JobRepository from '../data_layer/JobRepository';
import UploadService from '../services/UploadService';
import { getDatabase } from '../data_layer';
import UploadRepository from '../data_layer/UploadRespository';
import UsersRepository from '../data_layer/UsersRepository';
import SettingsRepository from '../data_layer/SettingsRepository';
import { ConversionOutputStatsRepository } from '../data_layer/ConversionOutputStatsRepository';
import { ParsePathSignatureRepository } from '../data_layer/ParsePathSignatureRepository';
import NotionRepository from '../data_layer/NotionRespository';
import BlocksCacheRepository from '../data_layer/BlocksCacheRepository';
import NotionService from '../services/NotionService';
import { DropboxRepository } from '../data_layer/DropboxRepository';
import { GoogleDriveRepository } from '../data_layer/GoogleDriveRepository';
import { GetDropboxUploadsUseCase } from '../usecases/uploads/GetDropboxUploadsUseCase';
import { DeleteDropboxUploadUseCase } from '../usecases/uploads/DeleteDropboxUploadUseCase';
import { GetGoogleDriveUploadsUseCase } from '../usecases/uploads/GetGoogleDriveUploadsUseCase';
import { DeleteGoogleDriveUploadUseCase } from '../usecases/uploads/DeleteGoogleDriveUploadUseCase';
import DeleteJobUseCase from '../usecases/jobs/DeleteJobUseCase';
import { ConversionRuleScoresRepository } from '../data_layer/ConversionRuleScoresRepository';
import { CardGuidLedgerRepository } from '../data_layer/CardGuidLedgerRepository';
import { EventsRepository } from '../data_layer/EventsRepository';
import { PhotoToFlashcardsUseCase } from '../usecases/imageOcclusion/PhotoToFlashcardsUseCase';
import NotionTopLevelPagesRepository from '../data_layer/NotionTopLevelPagesRepository';
import { GetRecentSourcesUseCase } from '../usecases/uploads/GetRecentSourcesUseCase';
import { RecentSourcesController } from '../controllers/Upload/RecentSourcesController';

const UploadRouter = () => {
  const router = express.Router();
  const database = getDatabase();
  const jobRepository = new JobRepository(database);
  const jobService = new JobService(jobRepository);
  const uploadService = new UploadService(
    new UploadRepository(database),
    jobRepository,
    new UsersRepository(database),
    new SettingsRepository(database),
    new ConversionOutputStatsRepository(database),
    new ParsePathSignatureRepository(database),
    new ConversionRuleScoresRepository(database),
    new CardGuidLedgerRepository(database),
    new PhotoToFlashcardsUseCase(new EventsRepository(database))
  );
  const jobController = new JobController(
    jobService,
    new DeleteJobUseCase(jobService, uploadService)
  );
  const dropboxRepository = new DropboxRepository(database);
  const googleDriveRepository = new GoogleDriveRepository(database);
  const recentSourcesController = new RecentSourcesController(
    new GetRecentSourcesUseCase(
      new NotionTopLevelPagesRepository(database),
      new UploadRepository(database)
    )
  );
  const saveNativeDeckController = new SaveNativeDeckController(
    new SaveNativeDeckUseCase(
      new UploadRepository(database),
      new StorageHandler()
    )
  );
  const uploadController = new UploadController(
    uploadService,
    new NotionService(
      new NotionRepository(database),
      undefined,
      new BlocksCacheRepository(database)
    ),
    new GetDropboxUploadsUseCase(dropboxRepository),
    new DeleteDropboxUploadUseCase(dropboxRepository),
    new GetGoogleDriveUploadsUseCase(googleDriveRepository),
    new DeleteGoogleDriveUploadUseCase(googleDriveRepository)
  );

  /**
   * This API is open to the public and therefore does not require authentication.
   * It is used to upload files to the server, and there is a whitelist in place to prevent
   * abuse. In the future, this API will be moved to a separate server.
   */

  /**
   * @swagger
   * /api/upload/file:
   *   post:
   *     summary: Upload a file
   *     description: Upload a file to be converted to Anki flashcards. This endpoint is public but has origin restrictions.
   *     tags: [Upload]
   *     requestBody:
   *       required: true
   *       content:
   *         multipart/form-data:
   *           schema:
   *             type: object
   *             properties:
   *               file:
   *                 type: string
   *                 format: binary
   *                 description: The file to upload (PDF, DOCX, etc.)
   *               options:
   *                 type: string
   *                 description: JSON string with conversion options
   *     responses:
   *       200:
   *         description: File uploaded successfully
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/Upload'
   *       400:
   *         description: Invalid file or request
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/Error'
   *       403:
   *         description: Origin not allowed
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/Error'
   */
  router.post('/api/upload/file', RequireAllowedOrigin, (req, res) =>
    uploadController.file(req, res)
  );

  /**
   * @swagger
   * /api/upload/save:
   *   post:
   *     summary: Save a built deck to the user's library
   *     description: Persist a built .apkg produced on a native device to My Decks. Paid users only. Accepts the built bytes plus metadata; the server does not rebuild the deck.
   *     tags: [Upload]
   *     security:
   *       - cookieAuth: []
   *     requestBody:
   *       required: true
   *       content:
   *         multipart/form-data:
   *           schema:
   *             type: object
   *             properties:
   *               file:
   *                 type: string
   *                 format: binary
   *                 description: The built .apkg deck
   *               name:
   *                 type: string
   *                 description: Display name for the deck
   *               dedupe_key:
   *                 type: string
   *                 description: Client-supplied key so re-saving the same deck does not duplicate rows
   *     responses:
   *       200:
   *         description: Deck saved to the library
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 key:
   *                   type: string
   *                 filename:
   *                   type: string
   *                 size_mb:
   *                   type: number
   *       400:
   *         description: Missing or non-apkg file
   *       401:
   *         description: Authentication required
   *       402:
   *         description: Upgrade required
   *       403:
   *         description: Origin not allowed
   *       413:
   *         description: Deck file is too large
   */
  router.post(
    '/api/upload/save',
    RequireAllowedOrigin,
    RequirePayingJson,
    multer({
      storage: multer.memoryStorage(),
      limits: { fileSize: 100 * 1024 * 1024 },
      fileFilter: (_req, file, cb) => {
        cb(null, path.extname(file.originalname).toLowerCase() === '.apkg');
      },
    }).single('file'),
    normalizeUploadFilenames,
    (req, res) => saveNativeDeckController.save(req, res)
  );

  router.post(
    '/api/upload/retry-with-credential',
    RequireAllowedOrigin,
    multer({
      dest: '/tmp',
      limits: { fileSize: 50 * 1024 * 1024 },
      fileFilter: (_req, file, cb) => {
        cb(null, path.extname(file.originalname).toLowerCase() === '.pdf');
      },
    }).single('file'),
    normalizeUploadFilenames,
    (req, res) => uploadController.retryPdfWithCredential(req, res)
  );

  /**
   * @swagger
   * /api/upload/dropbox:
   *   post:
   *     summary: Upload from Dropbox
   *     description: Import a file from Dropbox to be converted to Anki flashcards
   *     tags: [Upload]
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             required:
   *               - link
   *             properties:
   *               link:
   *                 type: string
   *                 format: uri
   *                 description: Dropbox share link to the file
   *               filename:
   *                 type: string
   *                 description: Original filename
   *               options:
   *                 type: object
   *                 description: Upload and conversion options
   *     responses:
   *       200:
   *         description: Dropbox file imported successfully
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/Upload'
   *       400:
   *         description: Invalid Dropbox link or request
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/Error'
   *       403:
   *         description: Origin not allowed
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/Error'
   */
  router.post(
    '/api/upload/dropbox',
    RequireAllowedOrigin,
    RequireAuthentication,
    multer({ dest: '/tmp' }).none(),
    (req, res) => uploadController.dropbox(req, res)
  );

  /**
   * @swagger
   * /api/upload/google_drive:
   *   post:
   *     summary: Upload from Google Drive
   *     description: Import a file from Google Drive to be converted to Anki flashcards
   *     tags: [Upload]
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             properties:
   *               fileId:
   *                 type: string
   *                 description: Google Drive file ID
   *               filename:
   *                 type: string
   *                 description: Original filename
   *     responses:
   *       200:
   *         description: Google Drive file imported successfully
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/Upload'
   *       400:
   *         description: Invalid Google Drive file ID or request
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/Error'
   */
  router.post(
    '/api/upload/google_drive',
    RequireAllowedOrigin,
    multer({ dest: '/tmp' }).none(),
    (req, res) => uploadController.googleDrive(req, res)
  );

  /**
   * @swagger
   * /api/upload/mine:
   *   get:
   *     summary: Get user's uploads
   *     description: Retrieve all uploads belonging to the authenticated user
   *     tags: [Upload]
   *     security:
   *       - bearerAuth: []
   *       - cookieAuth: []
   *     responses:
   *       200:
   *         description: List of user uploads retrieved successfully
   *         content:
   *           application/json:
   *             schema:
   *               type: array
   *               items:
   *                 $ref: '#/components/schemas/Upload'
   *       401:
   *         description: Authentication required
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/Error'
   */
  router.get('/api/upload/mine', RequireAuthentication, (req, res) =>
    uploadController.getUploads(req, res)
  );

  /**
   * @swagger
   * /api/upload/recent-sources:
   *   get:
   *     summary: Get the user's recent re-convertible sources
   *     description: Returns up to 3 recent Notion top-level pages and the user's last re-convertible upload, sorted by recency descending. Powers the Recent section on the upload page so deck #2 is one click.
   *     tags: [Upload]
   *     security:
   *       - bearerAuth: []
   *       - cookieAuth: []
   *     responses:
   *       200:
   *         description: Recent sources retrieved successfully
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 sources:
   *                   type: array
   *                   items:
   *                     type: object
   *                     properties:
   *                       id:
   *                         type: string
   *                       title:
   *                         type: string
   *                       type:
   *                         type: string
   *                         enum: [notion, remote_upload]
   *                       updatedAt:
   *                         type: string
   *                         format: date-time
   *                       convertUrl:
   *                         type: string
   *       401:
   *         description: Authentication required
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/Error'
   */
  router.get('/api/upload/recent-sources', RequireAuthentication, (req, res) =>
    recentSourcesController.get(req, res)
  );

  /**
   * @swagger
   * /api/upload/jobs:
   *   get:
   *     summary: Get user's conversion jobs
   *     description: Retrieve all conversion jobs belonging to the authenticated user
   *     tags: [Jobs]
   *     security:
   *       - bearerAuth: []
   *       - cookieAuth: []
   *     responses:
   *       200:
   *         description: List of user jobs retrieved successfully
   *         content:
   *           application/json:
   *             schema:
   *               type: array
   *               items:
   *                 type: object
   *                 properties:
   *                   id:
   *                     type: integer
   *                   status:
   *                     type: string
   *                     enum: [pending, processing, completed, failed]
   *                   title:
   *                     type: string
   *                   created_at:
   *                     type: string
   *                     format: date-time
   *       401:
   *         description: Authentication required
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/Error'
   */
  router.get('/api/upload/jobs', RequireAuthentication, (req, res) =>
    jobController.getJobsByOwner(req, res)
  );

  /**
   * @swagger
   * /api/upload/jobs/{id}:
   *   delete:
   *     summary: Delete a conversion job
   *     description: Delete a specific conversion job belonging to the authenticated user
   *     tags: [Jobs]
   *     security:
   *       - bearerAuth: []
   *       - cookieAuth: []
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema:
   *           type: integer
   *         description: Job ID to delete
   *     responses:
   *       200:
   *         description: Job deleted successfully
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/Success'
   *       401:
   *         description: Authentication required
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/Error'
   *       404:
   *         description: Job not found
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/Error'
   */
  router.delete('/api/upload/jobs/:id', RequireAuthentication, (req, res) =>
    jobController.deleteJobByOwner(req, res)
  );

  /**
   * @swagger
   * /api/upload/jobs/{jobId}/download:
   *   get:
   *     summary: Download a completed job result
   *     description: Download the APKG file produced by a completed Claude job
   *     tags: [Upload]
   *     security:
   *       - sessionAuth: []
   *     parameters:
   *       - in: path
   *         name: jobId
   *         required: true
   *         schema:
   *           type: string
   *     responses:
   *       200:
   *         description: APKG file download
   *       404:
   *         description: Job or file not found
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/Error'
   *       409:
   *         description: Job not done yet
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/Error'
   */
  router.get(
    '/api/upload/jobs/:jobId/download',
    RequireAuthentication,
    (req, res) => jobController.downloadJobResult(req, res)
  );

  /**
   * @swagger
   * /api/upload/jobs/{jobId}/report:
   *   get:
   *     summary: Get the conversion report for a job
   *     description: Fetch the per-conversion accounting stored on a completed job
   *     tags: [Jobs]
   *     security:
   *       - bearerAuth: []
   *       - cookieAuth: []
   *     parameters:
   *       - in: path
   *         name: jobId
   *         required: true
   *         schema:
   *           type: string
   *     responses:
   *       200:
   *         description: The conversion report
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 summary:
   *                   type: object
   *                   properties:
   *                     blocks_seen:
   *                       type: integer
   *                     cards_created:
   *                       type: integer
   *                     blocks_skipped:
   *                       type: integer
   *                 entries:
   *                   type: array
   *                   items:
   *                     type: object
   *                     properties:
   *                       stage:
   *                         type: string
   *                         enum: [block, media, card, output]
   *                       reason_code:
   *                         type: string
   *                       human_reason:
   *                         type: string
   *                       count:
   *                         type: integer
   *       401:
   *         description: Authentication required
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/Error'
   *       404:
   *         description: Job not found or no report stored
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/Error'
   */
  router.get(
    '/api/upload/jobs/:jobId/report',
    RequireAuthentication,
    (req, res) => jobController.getJobReport(req, res)
  );

  /**
   * @swagger
   * /api/upload/jobs/{jobId}/restart:
   *   post:
   *     summary: Restart an interrupted Claude job
   *     description: Restart a Claude flashcard job that was previously interrupted
   *     tags: [Upload]
   *     security:
   *       - sessionAuth: []
   *     parameters:
   *       - in: path
   *         name: jobId
   *         required: true
   *         schema:
   *           type: string
   *     responses:
   *       202:
   *         description: Job restart accepted
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 jobId:
   *                   type: string
   *       404:
   *         description: Job not found
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/Error'
   *       409:
   *         description: Workspace files no longer available
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/Error'
   */
  router.post(
    '/api/upload/jobs/:jobId/restart',
    RequireAuthentication,
    (req, res) => uploadController.restartJob(req, res)
  );

  /**
   * @swagger
   * /api/upload/mine/{key}:
   *   delete:
   *     summary: Delete an upload
   *     description: Delete a specific upload belonging to the authenticated user
   *     tags: [Upload]
   *     security:
   *       - bearerAuth: []
   *       - cookieAuth: []
   *     parameters:
   *       - in: path
   *         name: key
   *         required: true
   *         schema:
   *           type: string
   *         description: Upload key/ID to delete
   *     responses:
   *       200:
   *         description: Upload deleted successfully
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/Success'
   *       401:
   *         description: Authentication required
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/Error'
   *       404:
   *         description: Upload not found
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/Error'
   */
  router.delete('/api/upload/mine/:key', RequireAuthentication, (req, res) =>
    uploadController.deleteUpload(req, res)
  );

  /**
   * @swagger
   * /api/upload/dropbox/mine:
   *   get:
   *     summary: List the authenticated user's Dropbox upload history
   *     description: Returns the most recent Dropbox uploads for the logged-in user, sorted newest first. Folder entries are excluded.
   *     tags: [Upload]
   *     security:
   *       - sessionAuth: []
   *     parameters:
   *       - in: query
   *         name: offset
   *         required: false
   *         schema:
   *           type: integer
   *           minimum: 0
   *         description: Number of rows to skip for paging beyond the first page
   *     responses:
   *       200:
   *         description: Dropbox upload history retrieved successfully
   *         content:
   *           application/json:
   *             schema:
   *               type: array
   *               items:
   *                 type: object
   *                 properties:
   *                   id:
   *                     type: integer
   *                   name:
   *                     type: string
   *                   bytes:
   *                     type: integer
   *                   created_at:
   *                     type: string
   *                     format: date-time
   *                     nullable: true
   *       401:
   *         description: Authentication required
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/Error'
   */
  router.get('/api/upload/dropbox/mine', RequireAuthentication, (req, res) =>
    uploadController.getDropboxUploads(req, res)
  );

  /**
   * @swagger
   * /api/upload/dropbox/mine/{id}:
   *   delete:
   *     summary: Remove a row from the user's Dropbox upload history
   *     description: Deletes a single dropbox_uploads row owned by the authenticated user. The underlying file in Dropbox is not affected.
   *     tags: [Upload]
   *     security:
   *       - sessionAuth: []
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema:
   *           type: integer
   *         description: Dropbox upload row ID
   *     responses:
   *       200:
   *         description: History entry removed successfully
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/Success'
   *       400:
   *         description: Missing or invalid id
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/Error'
   *       401:
   *         description: Authentication required
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/Error'
   *       404:
   *         description: History entry not found
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/Error'
   */
  router.delete(
    '/api/upload/dropbox/mine/:id',
    RequireAuthentication,
    (req, res) => uploadController.deleteDropboxUpload(req, res)
  );

  /**
   * @swagger
   * /api/upload/google_drive/mine:
   *   get:
   *     summary: List the authenticated user's Google Drive upload history
   *     description: Returns the most recent Google Drive files the user has converted, ordered by last_converted_at descending. Folder entries are excluded.
   *     tags: [Upload]
   *     security:
   *       - sessionAuth: []
   *     parameters:
   *       - in: query
   *         name: offset
   *         required: false
   *         schema:
   *           type: integer
   *           minimum: 0
   *         description: Number of rows to skip for paging beyond the first page
   *     responses:
   *       200:
   *         description: Google Drive upload history retrieved successfully
   *         content:
   *           application/json:
   *             schema:
   *               type: array
   *               items:
   *                 type: object
   *                 properties:
   *                   id:
   *                     type: string
   *                   iconUrl:
   *                     type: string
   *                   mimeType:
   *                     type: string
   *                   name:
   *                     type: string
   *                   sizeBytes:
   *                     type: string
   *                     nullable: true
   *                   url:
   *                     type: string
   *                   last_converted_at:
   *                     type: string
   *                     format: date-time
   *                     nullable: true
   *       401:
   *         description: Authentication required
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/Error'
   */
  router.get(
    '/api/upload/google_drive/mine',
    RequireAuthentication,
    (req, res) => uploadController.getGoogleDriveUploads(req, res)
  );

  /**
   * @swagger
   * /api/upload/google_drive/mine/{id}:
   *   delete:
   *     summary: Remove a row from the user's Google Drive upload history
   *     description: Deletes a single google_drive_uploads row owned by the authenticated user. The underlying file in Drive is not affected.
   *     tags: [Upload]
   *     security:
   *       - sessionAuth: []
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema:
   *           type: string
   *         description: Google Drive file id (alphanumeric, underscore, hyphen)
   *     responses:
   *       200:
   *         description: History entry removed successfully
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/Success'
   *       400:
   *         description: Missing or invalid id
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/Error'
   *       401:
   *         description: Authentication required
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/Error'
   *       404:
   *         description: History entry not found
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/Error'
   */
  router.delete(
    '/api/upload/google_drive/mine/:id',
    RequireAuthentication,
    (req, res) => uploadController.deleteGoogleDriveUpload(req, res)
  );

  return router;
};

export default UploadRouter;
