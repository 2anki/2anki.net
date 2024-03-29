import express from 'express';
import multer from 'multer';
import { getUploadLimits } from './getUploadLimits';

export const getUploadHandler = (res: express.Response) => {
  const maxUploadCount = 21;

  return multer({
    limits: getUploadLimits(res.locals.patreon),
    dest: process.env.UPLOAD_BASE,
  }).array('pakker', maxUploadCount);
};
