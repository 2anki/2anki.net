import { vi, type Mock } from 'vitest';
import { APIErrorCode, APIResponseError } from '@notionhq/client';
import { Response } from 'express';

import sendErrorResponse from './sendErrorResponse';

interface FakeResponse {
  statusCode: number;
  body: unknown;
  status: Mock;
  json: Mock;
  send: Mock;
}

const makeResponse = (): FakeResponse => {
  const state = { statusCode: 200, body: undefined } as FakeResponse;
  state.status = vi.fn((code: number) => {
    state.statusCode = code;
    return state;
  });
  state.json = vi.fn((body: unknown) => {
    state.body = body;
    return state;
  });
  state.send = vi.fn(() => state);
  return state;
};

const makeAPIResponseError = (
  code: string,
  status: number
): APIResponseError => {
  const err = Object.create(APIResponseError.prototype) as APIResponseError;
  Object.assign(err, {
    name: 'APIResponseError',
    message: 'API token is invalid.',
    code,
    status,
  });
  return err;
};

describe('sendErrorResponse', () => {
  beforeEach(() => {
    vi.spyOn(console, 'info').mockImplementation(() => undefined);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it.each([
    [APIErrorCode.Unauthorized, 401, 'notion_unauthorized'],
    [APIErrorCode.ObjectNotFound, 404, 'notion_object_not_found'],
    [APIErrorCode.RateLimited, 429, 'notion_rate_limit'],
  ] as const)(
    'sends %s as status %i with code %s',
    (apiCode, status, uploadCode) => {
      const res = makeResponse();

      sendErrorResponse(
        makeAPIResponseError(apiCode, status),
        res as unknown as Response
      );

      expect(res.statusCode).toBe(status);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ code: uploadCode })
      );
    }
  );

  it('does not echo the Notion error message for mapped codes', () => {
    const res = makeResponse();

    sendErrorResponse(
      makeAPIResponseError(APIErrorCode.Unauthorized, 401),
      res as unknown as Response
    );

    expect((res.body as { message: string }).message).not.toContain(
      'API token is invalid'
    );
  });

  it('keeps the existing shape for unmapped Notion API errors', () => {
    const res = makeResponse();

    sendErrorResponse(
      makeAPIResponseError(APIErrorCode.ValidationError, 400),
      res as unknown as Response
    );

    expect(res.statusCode).toBe(400);
    expect(res.json).toHaveBeenCalledWith({ message: 'API token is invalid.' });
  });

  it('keeps the existing 500 shape for non-Notion errors', () => {
    const res = makeResponse();

    sendErrorResponse(new Error('boom'), res as unknown as Response);

    expect(res.statusCode).toBe(500);
    expect(res.json).toHaveBeenCalledWith({ message: 'Unknown error.' });
  });
});
