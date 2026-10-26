import { Response } from 'express';

import { APIErrorCode, APIResponseError } from '@notionhq/client';

import { toNotionUploadError } from './notion/toNotionUploadError';
import { NotionNotConnectedError } from './notion/NotionNotConnectedError';
import type { UploadErrorBody } from '../types/UploadErrorBody';

function isExpectedUserError(error: unknown): boolean {
  if (error instanceof NotionNotConnectedError) return true;
  if (!(error instanceof APIResponseError)) return false;
  // Notion returning Unauthorized means the user revoked access or
  // the stored token expired — it's an expected outcome that triggers
  // a reconnect flow, not a server bug.
  return error.code === APIErrorCode.Unauthorized;
}

export default function sendErrorResponse(
  error: Error | APIResponseError | unknown,
  response: Response
) {
  let status = 500;
  let body: { message: string } | UploadErrorBody = {
    message: 'Unknown error.',
  };

  const notionError = toNotionUploadError(error);
  if (notionError) {
    status = notionError.status;
    body = notionError.body;
  } else if (error instanceof APIResponseError) {
    status = error.status;
    body = { message: error.message };
  }

  if (isExpectedUserError(error)) {
    console.info(
      '[notion] expected user error',
      (error as APIResponseError).code
    );
  } else {
    console.error(error);
  }

  return response.status(status).json(body).send();
}
