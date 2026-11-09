import express from 'express';
import multer from 'multer';

import { isPaying } from '../../lib/isPaying';
import { getUploadLimits } from '../../lib/misc/getUploadLimits';

// The browser's saved settings ride along as form fields on a cloud pick and
// a password retry, as they do on a file upload, so these routes take the
// same field limit for the caller's plan. RequireAllowedOrigin has resolved
// the caller by now; a signed-out one gets the free limit.
export function fieldSizeForPlan(res: express.Response): number {
  return getUploadLimits(isPaying(res.locals)).fieldSize;
}

export function uploadFieldsByPlan(
  req: express.Request,
  res: express.Response,
  next: express.NextFunction
): void {
  multer({
    dest: '/tmp',
    limits: { fieldSize: fieldSizeForPlan(res) },
  }).none()(req, res, next);
}
