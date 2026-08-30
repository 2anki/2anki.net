import express from 'express';
import multer from 'multer';
import { getUploadLimits } from './getUploadLimits';
import { getMaxUploadCount } from './getMaxUploadCount';
import { isPaying } from '../isPaying';
import { decodeMultipartFilename } from './decodeMultipartFilename';
import { ensureUploadBytes } from '../../usecases/uploads/ensureUploadBytes';
import { UploadedFile } from '../storage/types';

type UploadHandler = (
  req: express.Request,
  res: express.Response,
  callback: (error?: Error) => void
) => void;

// Snapshot multer's disk-storage bytes the instant the upload finishes writing,
// before any async hop (auth, settings lookup, the Piscina queue). Multer's
// `dest` engine gives each file a `path` but no `buffer`; the conversion reads
// the file later in a worker, and the temp file under UPLOAD_BASE can vanish in
// the gap. Capturing here — while the file is provably on disk — populates the
// worker's buffer fallback so the conversion survives the file being reaped.
export function withNormalizedFilenames(
  handler: express.RequestHandler
): UploadHandler {
  return (req, res, callback) => {
    handler(req, res, (error?: unknown) => {
      if (error instanceof Error) {
        callback(error);
        return;
      }
      // A dead request has nothing to convert, and multer 2.x has already
      // removed its temp files — snapshotting would only ENOENT-spam the log
      // once per file (#4173). `req.destroyed` is deliberately not consulted:
      // Node auto-destroys IncomingMessage once its body is read, so it is
      // true for every healthy request by the time multer calls back and
      // would disable the snapshot everywhere.
      const requestDead = req.aborted || res.writableEnded || res.destroyed;
      const files = req.files as UploadedFile[] | undefined;
      if (files) {
        for (const file of files) {
          file.originalname = decodeMultipartFilename(file.originalname);
        }
        if (!requestDead) {
          ensureUploadBytes(files);
        }
      }
      if (req.file) {
        req.file.originalname = decodeMultipartFilename(req.file.originalname);
        if (!requestDead) {
          ensureUploadBytes([req.file as UploadedFile]);
        }
      }
      callback();
    });
  };
}

export const UPLOAD_FIELD = 'pakker';

export const getUploadHandler = (res: express.Response): UploadHandler => {
  const paying = isPaying(res.locals);
  const maxUploadCount = getMaxUploadCount(paying);

  const handler = multer({
    limits: getUploadLimits(paying),
    dest: process.env.UPLOAD_BASE,
  }).array(UPLOAD_FIELD, maxUploadCount);

  return withNormalizedFilenames(handler);
};
