import express, { Request, Response, NextFunction } from 'express';
import RequireAuthentication from './middleware/RequireAuthentication';
import ShareController from '../controllers/ShareController';
import ShareRepository from '../data_layer/ShareRepository';
import ShareService from '../services/ShareService';
import CreateShareUseCase from '../usecases/share/CreateShareUseCase';
import ResolveShareUseCase from '../usecases/share/ResolveShareUseCase';
import RevokeShareUseCase from '../usecases/share/RevokeShareUseCase';
import StorageHandler from '../lib/storage/StorageHandler';
import ApkgPreviewService from '../services/ApkgPreviewService/ApkgPreviewService';
import DownloadService from '../services/DownloadService';
import DownloadRepository from '../data_layer/DownloadRepository';
import UploadRepository from '../data_layer/UploadRespository';
import { getDatabase } from '../data_layer';
import { resolveClientIp } from '../lib/rateLimit/ipHelpers';

const MAX_REQUESTS_PER_IP_PER_MINUTE = 100;
const MAX_DOWNLOADS_PER_TOKEN_PER_HOUR = 10;
const ONE_MINUTE_MS = 60 * 1000;
const ONE_HOUR_MS = 60 * 60 * 1000;

interface Counter {
  count: number;
  resetAt: number;
}

const ipCounters = new Map<string, Counter>();
const tokenDownloadCounters = new Map<string, Counter>();

function checkCounter(
  map: Map<string, Counter>,
  key: string,
  limit: number,
  windowMs: number
): boolean {
  const now = Date.now();
  const entry = map.get(key);
  if (entry == null || now >= entry.resetAt) {
    map.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }
  if (entry.count >= limit) {
    return false;
  }
  entry.count++;
  return true;
}

function ipRateLimit(req: Request, res: Response, next: NextFunction) {
  const ip = resolveClientIp(req);
  if (
    checkCounter(ipCounters, ip, MAX_REQUESTS_PER_IP_PER_MINUTE, ONE_MINUTE_MS)
  ) {
    next();
  } else {
    res
      .status(429)
      .json({ message: 'Too many requests. Try again in a minute.' });
  }
}

function tokenDownloadRateLimit(
  req: Request,
  res: Response,
  next: NextFunction
) {
  const { token } = req.params;
  if (
    checkCounter(
      tokenDownloadCounters,
      token,
      MAX_DOWNLOADS_PER_TOKEN_PER_HOUR,
      ONE_HOUR_MS
    )
  ) {
    next();
  } else {
    res
      .status(429)
      .json({ message: 'Too many downloads for this link. Try again later.' });
  }
}

const ShareRouter = () => {
  const database = getDatabase();
  const shareRepository = new ShareRepository(database);
  const uploadRepository = new UploadRepository(database);
  const shareService = new ShareService(shareRepository);
  const downloadService = new DownloadService(new DownloadRepository(database));
  const previewService = new ApkgPreviewService();
  const storage = new StorageHandler();

  const createUseCase = new CreateShareUseCase(uploadRepository, shareService);
  const resolveUseCase = new ResolveShareUseCase(shareService);
  const revokeUseCase = new RevokeShareUseCase(shareService);

  const controller = new ShareController(
    createUseCase,
    resolveUseCase,
    revokeUseCase,
    shareService,
    storage,
    previewService,
    downloadService
  );

  const router = express.Router();

  /**
   * @swagger
   * /api/shares:
   *   post:
   *     summary: Create a public share link for one of the caller's uploads
   *     description: Generates an unguessable token and persists a `deck_shares` row tying it to the caller and the given `upload_key`.
   *     tags: [Deck Shares]
   *     security:
   *       - bearerAuth: []
   *       - cookieAuth: []
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             required: [upload_key]
   *             properties:
   *               upload_key:
   *                 type: string
   *                 description: S3 object key of an upload owned by the caller.
   *     responses:
   *       201:
   *         description: Share created
   *       400:
   *         description: Missing or invalid upload_key
   *       401:
   *         description: Authentication required
   *       403:
   *         description: Upload is not owned by the caller
   *       404:
   *         description: Upload not found
   */
  router.post('/api/shares', RequireAuthentication, (req, res) =>
    controller.createShare(req, res)
  );

  /**
   * @swagger
   * /api/shares:
   *   get:
   *     summary: List the caller's active share links
   *     description: Returns every non-revoked share row the caller owns, with token, url, upload_key, created_at, and view_count.
   *     tags: [Deck Shares]
   *     security:
   *       - bearerAuth: []
   *       - cookieAuth: []
   *     responses:
   *       200:
   *         description: Active shares for the caller
   *       401:
   *         description: Authentication required
   */
  router.get('/api/shares', RequireAuthentication, (req, res) =>
    controller.getActiveSharesForOwner(req, res)
  );

  /**
   * @swagger
   * /api/shares/{token}/meta:
   *   get:
   *     summary: Get shared deck preview metadata
   *     description: Public endpoint. Returns total card count and deck list for the shared deck. Rate-limited per IP. Responses carry `X-Robots-Tag&#58; noindex`.
   *     tags: [Deck Shares]
   *     parameters:
   *       - in: path
   *         name: token
   *         required: true
   *         schema:
   *           type: string
   *         description: Share token from POST /api/shares
   *     responses:
   *       200:
   *         description: Preview metadata
   *       404:
   *         description: Share not found or revoked
   *       429:
   *         description: Too many requests from this IP
   */
  router.get('/api/shares/:token/meta', ipRateLimit, (req, res) =>
    controller.getMeta(req, res)
  );

  /**
   * @swagger
   * /api/shares/{token}/cards:
   *   get:
   *     summary: Get a page of cards from a shared deck
   *     description: Public endpoint. Paginated, server-rendered card slice. Rate-limited per IP. Responses carry `X-Robots-Tag&#58; noindex`.
   *     tags: [Deck Shares]
   *     parameters:
   *       - in: path
   *         name: token
   *         required: true
   *         schema:
   *           type: string
   *         description: Share token from POST /api/shares
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
   *         description: Page of cards
   *       404:
   *         description: Share not found or revoked
   *       429:
   *         description: Too many requests from this IP
   */
  router.get('/api/shares/:token/cards', ipRateLimit, (req, res) =>
    controller.getCards(req, res)
  );

  /**
   * @swagger
   * /api/shares/{token}/media/{name}:
   *   get:
   *     summary: Serve a media file from a shared deck
   *     description: Public endpoint. Streams the named media file from the shared upload. Rate-limited per IP. Responses carry `X-Robots-Tag&#58; noindex` and a one-hour `Cache-Control`.
   *     tags: [Deck Shares]
   *     parameters:
   *       - in: path
   *         name: token
   *         required: true
   *         schema:
   *           type: string
   *         description: Share token from POST /api/shares
   *       - in: path
   *         name: name
   *         required: true
   *         schema:
   *           type: string
   *         description: Original filename as referenced by the card content.
   *     responses:
   *       200:
   *         description: File bytes
   *       404:
   *         description: Share not found, revoked, or file not in media manifest
   *       429:
   *         description: Too many requests from this IP
   */
  router.get('/api/shares/:token/media/:name', ipRateLimit, (req, res) =>
    controller.getMedia(req, res)
  );

  /**
   * @swagger
   * /api/shares/{token}/download:
   *   get:
   *     summary: Download the .apkg behind a shared deck
   *     description: Public endpoint. Streams the original .apkg bytes with `Content-Disposition&#58; attachment`. Rate-limited per IP and per token; increments view_count on success.
   *     tags: [Deck Shares]
   *     parameters:
   *       - in: path
   *         name: token
   *         required: true
   *         schema:
   *           type: string
   *         description: Share token from POST /api/shares
   *     responses:
   *       200:
   *         description: .apkg file stream
   *       404:
   *         description: Share not found or revoked
   *       429:
   *         description: Per-IP or per-token rate limit hit
   */
  router.get(
    '/api/shares/:token/download',
    ipRateLimit,
    tokenDownloadRateLimit,
    (req, res) => controller.download(req, res)
  );

  /**
   * @swagger
   * /api/shares/{token}:
   *   delete:
   *     summary: Revoke a share link
   *     description: Sets `revoked_at = NOW()` on a share row the caller owns. Idempotent — repeated calls or unknown tokens still return 204.
   *     tags: [Deck Shares]
   *     security:
   *       - bearerAuth: []
   *       - cookieAuth: []
   *     parameters:
   *       - in: path
   *         name: token
   *         required: true
   *         schema:
   *           type: string
   *         description: Share token to revoke
   *     responses:
   *       204:
   *         description: Revoked (or no-op for an unknown token)
   *       401:
   *         description: Authentication required
   */
  router.delete('/api/shares/:token', RequireAuthentication, (req, res) =>
    controller.revokeShare(req, res)
  );

  return router;
};

export default ShareRouter;
