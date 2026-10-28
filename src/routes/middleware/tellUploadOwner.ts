import express from 'express';

import { getOwner } from '../../lib/User/getOwner';
import {
  sessionOwnerOf,
  UPLOAD_OWNER_HEADER,
} from '../../lib/upload/keptFilesOwner';

// Set before the body is read, so a refusal, a limit and a crash carry it too.
export function tellUploadOwner(
  _req: express.Request,
  res: express.Response,
  next: express.NextFunction
): void {
  res.set(UPLOAD_OWNER_HEADER, sessionOwnerOf(getOwner(res)));
  next();
}
