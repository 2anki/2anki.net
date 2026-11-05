import { vi } from 'vitest';
import express from 'express';
import multer from 'multer';

import { answerUploadFieldTooLong } from './answerUploadFieldTooLong';

function makeResponse() {
  const res = { statusCode: 0, body: undefined as unknown };
  return Object.assign(res, {
    status(code: number) {
      res.statusCode = code;
      return this;
    },
    json(body: unknown) {
      res.body = body;
      return this;
    },
  });
}

describe('answerUploadFieldTooLong', () => {
  it('answers an over-long field with 413 and the upload copy', () => {
    const res = makeResponse();
    const next = vi.fn();

    answerUploadFieldTooLong(
      new multer.MulterError('LIMIT_FIELD_VALUE', 'user-instructions'),
      {} as express.Request,
      res as unknown as express.Response,
      next
    );

    expect(res.statusCode).toBe(413);
    expect(res.body).toEqual({
      code: 'unknown',
      message:
        'Your user instructions for PDF conversion are too long. Shorten them under PDF & AI in Settings, then upload again.',
    });
    expect(next).not.toHaveBeenCalled();
  });

  it.each([
    ['another multer error', new multer.MulterError('LIMIT_FILE_SIZE')],
    ['any other error', new Error('boom')],
  ])('passes %s on to the error handler', (_label, err) => {
    const res = makeResponse();
    const next = vi.fn();

    answerUploadFieldTooLong(
      err,
      {} as express.Request,
      res as unknown as express.Response,
      next
    );

    expect(next).toHaveBeenCalledWith(err);
    expect(res.statusCode).toBe(0);
  });
});
