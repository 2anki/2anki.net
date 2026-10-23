import {
  APIErrorCode,
  APIResponseError,
  UnknownHTTPResponseError,
} from '@notionhq/client';

import type { UploadErrorBody } from '../../types/UploadErrorBody';
import { NotionNotConnectedError } from './NotionNotConnectedError';

export interface NotionUploadError {
  status: number;
  body: UploadErrorBody;
}

const NOTION_UPLOAD_ERRORS: Partial<Record<APIErrorCode, NotionUploadError>> = {
  [APIErrorCode.Unauthorized]: {
    status: 401,
    body: {
      code: 'notion_unauthorized',
      message:
        'Your Notion connection expired. Reconnect Notion and try again.',
    },
  },
  [APIErrorCode.ObjectNotFound]: {
    status: 404,
    body: {
      code: 'notion_object_not_found',
      message:
        "We couldn't open that Notion page. Share it with the 2anki integration in Notion, then try again.",
    },
  },
  [APIErrorCode.RateLimited]: {
    status: 429,
    body: {
      code: 'notion_rate_limit',
      message:
        'Notion is rate-limiting us right now. Wait a minute and convert again.',
    },
  },
};

const NOTION_UNAVAILABLE: NotionUploadError = {
  status: 503,
  body: {
    code: 'notion_unavailable',
    message: 'Notion is having trouble right now. Try again in a minute.',
  },
};

const NOTION_OUTAGE_CODES = new Set<string>([
  APIErrorCode.InternalServerError,
  APIErrorCode.ServiceUnavailable,
  'gateway_timeout',
  APIErrorCode.ServiceOverload,
]);

export function toNotionUploadError(error: unknown): NotionUploadError | null {
  if (error instanceof NotionNotConnectedError) {
    return NOTION_UPLOAD_ERRORS[APIErrorCode.Unauthorized] ?? null;
  }
  if (error instanceof APIResponseError) {
    if (NOTION_OUTAGE_CODES.has(error.code)) return NOTION_UNAVAILABLE;
    return NOTION_UPLOAD_ERRORS[error.code] ?? null;
  }
  if (
    UnknownHTTPResponseError.isUnknownHTTPResponseError(error) &&
    error.status >= 500
  ) {
    return NOTION_UNAVAILABLE;
  }
  return null;
}
