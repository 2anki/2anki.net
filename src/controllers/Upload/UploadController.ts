import express from 'express';
import fs from 'node:fs';
import multer from 'multer';

import {
  getAnonymousPassId,
  getOwner,
  getOwnerId,
} from '../../lib/User/getOwner';
import {
  InMemoryRateLimiter,
  RateLimiter,
} from '../../lib/rateLimit/InMemoryRateLimiter';
import { hashIp, resolveClientIp } from '../../lib/rateLimit/ipHelpers';
import NotionService from '../../services/NotionService';
import UploadService from '../../services/UploadService';
import {
  getUploadHandler,
  UPLOAD_FIELD,
} from '../../lib/misc/GetUploadHandler';
import { getMaxUploadCount } from '../../lib/misc/getMaxUploadCount';
import { isLimitError } from '../../lib/misc/isLimitError';
import { handleUploadLimitError } from './helpers/handleUploadLimitError';
import { handleDropbox } from './helpers/handleDropbox';
import { handleGoogleDrive } from './helpers/handleGoogleDrive';
import { GetDropboxUploadsUseCase } from '../../usecases/uploads/GetDropboxUploadsUseCase';
import { DeleteDropboxUploadUseCase } from '../../usecases/uploads/DeleteDropboxUploadUseCase';
import { GetGoogleDriveUploadsUseCase } from '../../usecases/uploads/GetGoogleDriveUploadsUseCase';
import { DeleteGoogleDriveUploadUseCase } from '../../usecases/uploads/DeleteGoogleDriveUploadUseCase';
import { validatePdfCredential } from '../../lib/pdf/validatePdfCredential';
import { RetryPdfWithCredentialUseCase } from '../../usecases/uploads/RetryPdfWithCredentialUseCase';
import { isPaying } from '../../lib/isPaying';
import CardOption from '../../lib/parser/Settings';
import Workspace from '../../lib/parser/WorkSpace';
import { toText } from '../../services/NotionService/BlockHandler/helpers/deckNameToText';
import { toUploadResponse } from '../../types/UploadResponse';
import {
  keptFilesChangedOwner,
  sessionOwnerOf,
  SIGNED_OUT_SESSION,
  takeKeptOwner,
} from '../../lib/upload/keptFilesOwner';
import type { UploadErrorBody } from '../../types/UploadErrorBody';

const DROPBOX_PAGE_SIZE = 10;
const GOOGLE_DRIVE_PAGE_SIZE = 10;
const GOOGLE_DRIVE_ID_PATTERN = /^[A-Za-z0-9_-]+$/;

// `.array(field, maxCount)` reports an over-count file as LIMIT_UNEXPECTED_FILE
// on that field; LIMIT_FILE_COUNT only fires from `limits.files`, which the
// upload handler does not set. Both mean "more files than the plan takes".
function isFileCountError(error: unknown): boolean {
  if (!(error instanceof multer.MulterError)) return false;
  return (
    error.code === 'LIMIT_FILE_COUNT' ||
    (error.code === 'LIMIT_UNEXPECTED_FILE' && error.field === UPLOAD_FIELD)
  );
}

function removeTempUpload(tempPath: string): Promise<void> {
  return fs.promises.unlink(tempPath).catch((e) => {
    console.error('[upload] temp file cleanup failed', {
      error: e instanceof Error ? e.message : String(e),
    });
  });
}

const RETRY_PDF_WINDOW_MS = 60_000;
const RETRY_PDF_PER_IP_MAX = 10;
const RETRY_PDF_GLOBAL_MAX = 500;

class UploadController {
  private readonly retryPdfRateLimiter: RateLimiter;

  constructor(
    private readonly service: UploadService,
    private readonly notionService: NotionService,
    private readonly getDropboxUploadsUseCase?: GetDropboxUploadsUseCase,
    private readonly deleteDropboxUploadUseCase?: DeleteDropboxUploadUseCase,
    private readonly getGoogleDriveUploadsUseCase?: GetGoogleDriveUploadsUseCase,
    private readonly deleteGoogleDriveUploadUseCase?: DeleteGoogleDriveUploadUseCase,
    retryPdfRateLimiter?: RateLimiter
  ) {
    this.retryPdfRateLimiter =
      retryPdfRateLimiter ??
      new InMemoryRateLimiter({
        windowMs: RETRY_PDF_WINDOW_MS,
        perKeyMax: RETRY_PDF_PER_IP_MAX,
        globalMax: RETRY_PDF_GLOBAL_MAX,
      });
  }

  async deleteUpload(req: express.Request, res: express.Response) {
    const owner = getOwner(res);
    const { key } = req.params;

    if (!key) {
      return res.status(400).json({ message: 'Missing upload key.' });
    }

    try {
      await this.service.deleteUpload(owner, key);
      await this.notionService.purgeBlockCache(owner);
    } catch (error) {
      console.info('Delete upload failed');
      console.error(error);
      return res
        .status(500)
        .json({ message: 'Failed to delete upload. Please try again.' });
    }

    return res.status(200).json({});
  }

  async getUploads(_req: express.Request, res: express.Response) {
    const owner = getOwner(res);
    try {
      const uploads = await this.service.getUploadsByOwner(owner);
      res.json(uploads.map(toUploadResponse));
    } catch (error) {
      console.info('Get uploads failed');
      console.error(error);
      res
        .status(500)
        .json({ message: 'Failed to load uploads. Please try again.' });
    }
  }

  file(req: express.Request, res: express.Response) {
    try {
      console.info('uploading file');
      const handleUploadEndpoint = getUploadHandler(res);

      handleUploadEndpoint(req, res, async (error) => {
        if (
          error instanceof multer.MulterError &&
          error.code === 'LIMIT_FILE_SIZE'
        ) {
          return res.status(413).json({
            code: 'too_large',
            message:
              'Upload failed — the file is over your plan’s size limit. Try splitting it.',
          });
        }
        if (isFileCountError(error)) {
          const cap = getMaxUploadCount(isPaying(res.locals));
          return res.status(400).json({
            code: 'too_many_files',
            message: `Upload failed — that’s more than ${cap} files at once. Send them in smaller batches.`,
          });
        }
        if (isLimitError(error)) {
          return handleUploadLimitError(
            req,
            res,
            error instanceof Error ? error : null
          );
        }
        // Any other multer error means the body broke off or was refused, and
        // multer has already deleted every temp file it wrote. Converting the
        // leftover entries in req.files only ever ended in ENOENT (#4761).
        if (error != null) {
          return this.service.respondToBrokenUpload(req, res, error);
        }
        const uploaded = (req.files as Express.Multer.File[] | undefined) ?? [];
        if (await this.refusedForChangedOwner(req, res, uploaded)) {
          return;
        }
        await this.service.handleUpload(req, res);
      });
    } catch (error) {
      console.info('Upload file failed');
      console.error(error);
      res.status(400).json({
        message:
          'Failed to process the upload. Please try a different file or contact support.',
      });
    }
  }

  // Files a page kept from an earlier submit go back only under the session
  // that sent them: an account that signed in since, on a shared computer or
  // in another tab, must not receive that file or pay for its conversion.
  private async refusedForChangedOwner(
    req: express.Request,
    res: express.Response,
    uploaded: Pick<Express.Multer.File, 'path'>[]
  ): Promise<boolean> {
    const owner = getOwner(res);
    if (!keptFilesChangedOwner(takeKeptOwner(req.body), owner)) {
      return false;
    }
    await Promise.all(
      uploaded
        .filter((file) => file.path != null)
        .map((file) => removeTempUpload(file.path))
    );
    console.info('[upload] refused a resend sent under another session', {
      requestId: res.locals.requestId,
    });
    const body: UploadErrorBody = {
      code: 'owner_changed',
      message:
        'You switched accounts since this file was sent, so nothing was converted. Choose the file again.',
      signed_in: sessionOwnerOf(owner) !== SIGNED_OUT_SESSION,
    };
    res.status(409).json(body);
    return true;
  }

  async restartJob(req: express.Request, res: express.Response) {
    return this.service.restartClaudeJob(req, res);
  }

  async dropbox(req: express.Request, res: express.Response): Promise<void> {
    await handleDropbox(
      req,
      res,
      this.service.handleUpload.bind(this.service)
    ).then(() => {
      console.debug('dropbox upload success');
    });
  }

  async googleDrive(req: express.Request, res: express.Response) {
    await handleGoogleDrive(
      req,
      res,
      this.service.handleUpload.bind(this.service)
    ).then(() => {
      console.debug('google drive upload success');
    });
  }

  async getDropboxUploads(req: express.Request, res: express.Response) {
    const owner = getOwner(res);
    if (owner == null) {
      return res.status(401).json({ message: 'Authentication required.' });
    }

    const rawOffset = (req.query as Record<string, string>).offset;
    const offset = rawOffset != null ? parseInt(rawOffset, 10) : 0;

    try {
      const uploads = await this.getDropboxUploadsUseCase!.execute(
        owner,
        DROPBOX_PAGE_SIZE,
        Number.isFinite(offset) ? offset : 0
      );
      return res.json(uploads);
    } catch (error) {
      console.error('getDropboxUploads failed', error);
      return res.status(500).json({
        message:
          "Couldn't load your Dropbox history right now. Refresh to try again.",
      });
    }
  }

  async deleteDropboxUpload(req: express.Request, res: express.Response) {
    const owner = getOwner(res);
    if (owner == null) {
      return res.status(401).json({ message: 'Authentication required.' });
    }

    const rawId = (req.params as Record<string, string>).id;
    if (rawId == null) {
      return res.status(400).json({ message: 'Missing upload id.' });
    }

    const id = parseInt(rawId, 10);
    if (!Number.isFinite(id)) {
      return res.status(400).json({ message: 'Invalid upload id.' });
    }

    try {
      await this.deleteDropboxUploadUseCase!.execute(id, owner);
      return res.json({});
    } catch (error) {
      return res.status(404).json({ message: 'Upload not found.' });
    }
  }

  async getGoogleDriveUploads(req: express.Request, res: express.Response) {
    const owner = getOwner(res);
    if (owner == null) {
      return res.status(401).json({ message: 'Authentication required.' });
    }

    const rawOffset = (req.query as Record<string, string>).offset;
    const offset = rawOffset != null ? parseInt(rawOffset, 10) : 0;

    try {
      const uploads = await this.getGoogleDriveUploadsUseCase!.execute(
        owner,
        GOOGLE_DRIVE_PAGE_SIZE,
        Number.isFinite(offset) ? offset : 0
      );
      return res.json(uploads);
    } catch (error) {
      console.error('getGoogleDriveUploads failed', error);
      return res.status(500).json({
        message:
          "Couldn't load your Google Drive history right now. Refresh to try again.",
      });
    }
  }

  async deleteGoogleDriveUpload(req: express.Request, res: express.Response) {
    const owner = getOwner(res);
    if (owner == null) {
      return res.status(401).json({ message: 'Authentication required.' });
    }

    const rawId = (req.params as Record<string, string>).id;
    if (rawId == null || !GOOGLE_DRIVE_ID_PATTERN.test(rawId)) {
      return res.status(400).json({ message: 'Invalid upload id.' });
    }

    try {
      await this.deleteGoogleDriveUploadUseCase!.execute(rawId, owner);
      return res.json({});
    } catch (error) {
      return res.status(404).json({ message: 'Upload not found.' });
    }
  }

  async retryPdfWithCredential(req: express.Request, res: express.Response) {
    const uploadedFile = req.file;
    if (!uploadedFile) {
      return res.status(400).json({ message: 'No file provided.' });
    }
    if (await this.refusedForChangedOwner(req, res, [uploadedFile])) {
      return;
    }

    const ipKey = hashIp(resolveClientIp(req));
    if (!this.retryPdfRateLimiter.check(ipKey)) {
      void removeTempUpload(uploadedFile.path);
      res.set('Retry-After', '60');
      return res.status(429).json({
        message:
          'Too many password attempts. Please wait a minute and try again.',
      });
    }

    const credential = validatePdfCredential(
      (req.body as Record<string, unknown>).credential
    );
    if (credential == null) {
      return res.status(400).json({ message: 'Invalid credential.' });
    }

    let fileBuffer: Buffer;
    try {
      fileBuffer = fs.readFileSync(uploadedFile.path);
      void removeTempUpload(uploadedFile.path);
    } catch {
      void removeTempUpload(uploadedFile.path);
      return res.status(400).json({ message: 'Could not read uploaded file.' });
    }

    const filename = uploadedFile.originalname;
    const paying = isPaying(res.locals);
    // Nobody can answer a question here, so a PDF without text keeps the page
    // pairs it always made.
    const settings = new CardOption({
      ...((req.body as Record<string, string>) || {}),
      'pdf-fallback': 'pairs',
    });
    const workspace = new Workspace(true, 'fs');

    const useCase = new RetryPdfWithCredentialUseCase();
    const outcome = await useCase.execute(
      fileBuffer,
      filename,
      credential,
      paying,
      settings,
      workspace,
      getOwnerId(res),
      getAnonymousPassId(res)
    );

    if ('needsCredential' in outcome) {
      return res.status(400).json({
        error: 'needs_password',
        reason: outcome.reason,
      });
    }

    const { apkg, cardCount, name } = outcome;
    const deckName = toText(name);
    res.set('Content-Type', 'application/apkg');
    res.set('Content-Length', Buffer.byteLength(apkg).toString());
    res.set('X-Card-Count', cardCount.toString());
    res.set('Access-Control-Expose-Headers', 'File-Name, X-Card-Count');
    try {
      res.set('File-Name', encodeURIComponent(deckName));
    } catch {
      console.info(
        `retryPdfWithCredential: failed to encode filename ${deckName}`
      );
    }
    res.attachment(`/${deckName}`);
    return res.status(200).send(apkg);
  }
}

export default UploadController;
