import express from 'express';
import multer from 'multer';

import { uploadFieldTooLongMessage } from '../../lib/upload/fieldTooLongMessage';

// Dropbox and Drive picks and the password retry send the saved card
// settings as fields, as the file upload does, so an over-long one gets the
// upload copy rather than the form copy ErrorHandler gives every other route.
export function answerUploadFieldTooLong(
  err: unknown,
  _req: express.Request,
  res: express.Response,
  next: express.NextFunction
): void {
  if (err instanceof multer.MulterError && err.code === 'LIMIT_FIELD_VALUE') {
    console.info('[upload] field over the size limit', {
      requestId: res.locals.requestId,
      field: err.field,
    });
    res.status(413).json({
      code: 'unknown',
      message: uploadFieldTooLongMessage(err.field),
    });
    return;
  }
  next(err);
}
