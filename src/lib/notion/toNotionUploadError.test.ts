import {
  APIErrorCode,
  APIResponseError,
  UnknownHTTPResponseError,
} from '@notionhq/client';

import { NotionNotConnectedError } from './NotionNotConnectedError';
import { toNotionUploadError } from './toNotionUploadError';

function makeUnknownHttpError(status: number): UnknownHTTPResponseError {
  const err = Object.create(
    UnknownHTTPResponseError.prototype
  ) as UnknownHTTPResponseError;
  Object.assign(err, {
    name: 'UnknownHTTPResponseError',
    message: '<html>cf-error-522</html>',
    code: 'notionhq_client_response_error',
    status,
    headers: {},
  });
  return err;
}

const NOTION_UNAVAILABLE = {
  status: 503,
  body: {
    code: 'notion_unavailable',
    message: 'Notion is having trouble right now. Try again in a minute.',
  },
};

function makeAPIResponseError(code: string, status: number): APIResponseError {
  const err = Object.create(APIResponseError.prototype) as APIResponseError;
  Object.assign(err, {
    name: 'APIResponseError',
    message: `notion internal detail for ${code}`,
    code,
    status,
  });
  return err;
}

describe('toNotionUploadError', () => {
  it('maps an unauthorized Notion error to 401 notion_unauthorized', () => {
    const result = toNotionUploadError(
      makeAPIResponseError(APIErrorCode.Unauthorized, 401)
    );

    expect(result).toEqual({
      status: 401,
      body: {
        code: 'notion_unauthorized',
        message:
          'Your Notion connection expired. Reconnect Notion and try again.',
      },
    });
  });

  it('maps an object-not-found Notion error to 404 notion_object_not_found', () => {
    const result = toNotionUploadError(
      makeAPIResponseError(APIErrorCode.ObjectNotFound, 404)
    );

    expect(result).toEqual({
      status: 404,
      body: {
        code: 'notion_object_not_found',
        message:
          "We couldn't open that Notion page. Share it with the 2anki integration in Notion, then try again.",
      },
    });
  });

  it('maps a rate-limited Notion error to 429 notion_rate_limit', () => {
    const result = toNotionUploadError(
      makeAPIResponseError(APIErrorCode.RateLimited, 429)
    );

    expect(result).toEqual({
      status: 429,
      body: {
        code: 'notion_rate_limit',
        message:
          'Notion is rate-limiting us right now. Wait a minute and convert again.',
      },
    });
  });

  it('never echoes the Notion error message back to the client', () => {
    const result = toNotionUploadError(
      makeAPIResponseError(APIErrorCode.Unauthorized, 401)
    );

    expect(result?.body.message).not.toContain('notion internal detail');
  });

  it('answers a missing or rejected connection as notion_unauthorized', () => {
    expect(toNotionUploadError(new NotionNotConnectedError())).toMatchObject({
      status: 401,
      body: { code: 'notion_unauthorized' },
    });
  });

  it.each([522, 500, 503])(
    'answers a Notion %i outage as notion_unavailable without its HTML body',
    (status) => {
      expect(toNotionUploadError(makeUnknownHttpError(status))).toEqual(
        NOTION_UNAVAILABLE
      );
    }
  );

  it.each([
    APIErrorCode.InternalServerError,
    APIErrorCode.ServiceUnavailable,
    APIErrorCode.ServiceOverload,
  ])('answers Notion %s as notion_unavailable', (code) => {
    expect(toNotionUploadError(makeAPIResponseError(code, 503))).toEqual(
      NOTION_UNAVAILABLE
    );
  });

  it('leaves a 4xx unknown HTTP answer unmapped', () => {
    expect(toNotionUploadError(makeUnknownHttpError(400))).toBeNull();
  });

  it('returns null for other Notion API error codes', () => {
    expect(
      toNotionUploadError(
        makeAPIResponseError(APIErrorCode.ValidationError, 400)
      )
    ).toBeNull();
  });

  it('returns null for non-Notion errors', () => {
    expect(toNotionUploadError(new Error('plain failure'))).toBeNull();
    expect(toNotionUploadError(undefined)).toBeNull();
  });
});
