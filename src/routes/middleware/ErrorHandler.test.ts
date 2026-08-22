import { APIErrorCode, APIResponseError } from '@notionhq/client';
import express from 'express';
import multer from 'multer';

import ErrorHandler from './ErrorHandler';
import { PythonExitError } from '../../lib/anki/buildPythonExitError';

const makeAPIResponseError = (
  code: string,
  status: number
): APIResponseError => {
  const err = Object.create(APIResponseError.prototype) as APIResponseError;
  Object.assign(err, { name: 'APIResponseError', message: code, code, status });
  return err;
};

const makeRequest = (): express.Request =>
  ({
    body: {},
    path: '/api/sample',
    method: 'POST',
    query: {},
    files: [],
  }) as unknown as express.Request;

interface FakeResponse {
  headersSent: boolean;
  statusCode: number;
  headers: Record<string, string>;
  body: unknown;
  set: jest.Mock;
  status: jest.Mock;
  send: jest.Mock;
  json: jest.Mock;
}

const makeResponse = (headersSent: boolean): FakeResponse => {
  const state: FakeResponse = {
    headersSent,
    statusCode: 200,
    headers: {},
    body: undefined,
  } as FakeResponse;

  state.set = jest.fn((name: string, value: string) => {
    if (state.headersSent) {
      throw Object.assign(
        new Error('Cannot set headers after they are sent to the client'),
        { code: 'ERR_HTTP_HEADERS_SENT' }
      );
    }
    state.headers[name] = value;
    return state;
  });

  state.status = jest.fn((code: number) => {
    if (state.headersSent) {
      throw Object.assign(
        new Error('Cannot set headers after they are sent to the client'),
        { code: 'ERR_HTTP_HEADERS_SENT' }
      );
    }
    state.statusCode = code;
    return state;
  });

  state.send = jest.fn((body: unknown) => {
    state.body = body;
    state.headersSent = true;
    return state;
  });

  state.json = jest.fn((body: unknown) => {
    state.body = body;
    state.headersSent = true;
    return state;
  });

  return state;
};

describe('ErrorHandler', () => {
  test('emits JSON with code=unknown and message for a plain error', async () => {
    const res = makeResponse(false);
    const req = makeRequest();

    await ErrorHandler(
      res as unknown as express.Response,
      req,
      new Error('something failed')
    );

    expect(res.statusCode).toBe(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ code: 'unknown', message: 'something failed' })
    );
  });

  test('emits code=invalid_markup for a PythonExitError with kind invalid-markup', async () => {
    const res = makeResponse(false);
    const req = makeRequest();

    const err = new PythonExitError('markup error', {
      kind: 'invalid-markup',
      rawOutput: 'UserWarning: ...',
      code: 1,
    });

    await ErrorHandler(res as unknown as express.Response, req, err);

    expect(res.statusCode).toBe(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        code: 'invalid_markup',
        message: 'markup error',
      })
    );
  });

  test('emits code=too_large for a PythonExitError with kind too-large', async () => {
    const res = makeResponse(false);
    const req = makeRequest();

    const err = new PythonExitError('too large', {
      kind: 'too-large',
      rawOutput: 'MemoryError',
      code: null,
    });

    await ErrorHandler(res as unknown as express.Response, req, err);

    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ code: 'too_large' })
    );
  });

  test('emits code=malformed_notion for a PythonExitError with kind unsupported-data-source', async () => {
    const res = makeResponse(false);
    const req = makeRequest();

    const err = new PythonExitError('notion error', {
      kind: 'unsupported-data-source',
      rawOutput: "Unsupported 'data_source'!",
      code: 1,
    });

    await ErrorHandler(res as unknown as express.Response, req, err);

    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ code: 'malformed_notion' })
    );
  });

  test('never sends raw output to the client for an unknown PythonExitError', async () => {
    const res = makeResponse(false);
    const req = makeRequest();

    const err = new PythonExitError('generic message', {
      kind: 'unknown',
      rawOutput: 'KeyError: /workspace/123/deck.html exploded',
      code: 1,
    });

    await ErrorHandler(res as unknown as express.Response, req, err);

    expect(res.statusCode).toBe(400);
    expect(res.json).toHaveBeenCalledWith({
      code: 'unknown',
      message: 'generic message',
    });
  });

  test('emits code=too_large for multer LIMIT_FILE_SIZE', async () => {
    const res = makeResponse(false);
    const req = makeRequest();

    const err = new multer.MulterError('LIMIT_FILE_SIZE');

    await ErrorHandler(res as unknown as express.Response, req, err);

    expect(res.statusCode).toBe(413);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        code: 'too_large',
        message: expect.stringContaining('100 MB'),
      })
    );
  });

  test('emits code=unsupported_format for multer LIMIT_UNEXPECTED_FILE', async () => {
    const res = makeResponse(false);
    const req = makeRequest();

    const err = new multer.MulterError('LIMIT_UNEXPECTED_FILE');

    await ErrorHandler(res as unknown as express.Response, req, err);

    expect(res.statusCode).toBe(415);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        code: 'unsupported_format',
        message: expect.stringContaining('.zip'),
      })
    );
  });

  test('emits code=unknown with multer message for other MulterErrors', async () => {
    const res = makeResponse(false);
    const req = makeRequest();

    const err = new multer.MulterError('LIMIT_PART_COUNT');

    await ErrorHandler(res as unknown as express.Response, req, err);

    expect(res.statusCode).toBe(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ code: 'unknown' })
    );
  });

  test.each([
    [APIErrorCode.Unauthorized, 401, 'notion_unauthorized'],
    [APIErrorCode.ObjectNotFound, 404, 'notion_object_not_found'],
    [APIErrorCode.RateLimited, 429, 'notion_rate_limit'],
  ] as const)(
    'emits %s as status %i with code %s',
    async (apiCode, status, uploadCode) => {
      const res = makeResponse(false);
      const req = makeRequest();

      await ErrorHandler(
        res as unknown as express.Response,
        req,
        makeAPIResponseError(apiCode, status)
      );

      expect(res.statusCode).toBe(status);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ code: uploadCode })
      );
    }
  );

  test('keeps code=unknown for unmapped Notion API errors', async () => {
    const res = makeResponse(false);
    const req = makeRequest();

    await ErrorHandler(
      res as unknown as express.Response,
      req,
      makeAPIResponseError(APIErrorCode.ValidationError, 400)
    );

    expect(res.statusCode).toBe(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ code: 'unknown' })
    );
  });

  test('does not log a stack for a malformed-JSON scanner probe, still returns 400', async () => {
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    const res = makeResponse(false);
    const req = makeRequest();
    const probe = Object.assign(new SyntaxError('bad json'), {
      type: 'entity.parse.failed',
    });

    await ErrorHandler(res as unknown as express.Response, req, probe);

    expect(errorSpy).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(400);
    errorSpy.mockRestore();
  });

  test('does not log a stack for an AnkiAppExportError, still returns 400', async () => {
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    const res = makeResponse(false);
    const req = makeRequest();
    const err = new Error('No cards found in this AnkiApp export.');
    err.name = 'AnkiAppExportError';

    await ErrorHandler(res as unknown as express.Response, req, err);

    expect(errorSpy).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        message: 'No cards found in this AnkiApp export.',
      })
    );
    errorSpy.mockRestore();
  });

  test('still logs a stack for a genuine server error', async () => {
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    const res = makeResponse(false);
    const req = makeRequest();

    await ErrorHandler(
      res as unknown as express.Response,
      req,
      new Error('database connection lost')
    );

    expect(errorSpy).toHaveBeenCalled();
    errorSpy.mockRestore();
  });

  test('does not throw when headers have already been sent', async () => {
    const res = makeResponse(true);
    const req = makeRequest();

    await expect(
      ErrorHandler(
        res as unknown as express.Response,
        req,
        new Error('late failure')
      )
    ).resolves.toBeUndefined();

    expect(res.set).not.toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
    expect(res.send).not.toHaveBeenCalled();
    expect(res.json).not.toHaveBeenCalled();
  });

  test('a TypeError responds 500 with a generic body, not the internal message', async () => {
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    const res = makeResponse(false);
    const req = makeRequest();

    await ErrorHandler(
      res as unknown as express.Response,
      req,
      new TypeError(
        "Cannot destructure property 'name' of 'req.body' as it is undefined."
      )
    );

    expect(res.statusCode).toBe(500);
    const body = res.body as { code: string; message: string };
    expect(body.code).toBe('unknown');
    expect(body.message).not.toContain('req.body');
    expect(body.message).toContain('support@2anki.net');
    errorSpy.mockRestore();
  });

  test('a Knex pool error responds 500 with a generic body', async () => {
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    const res = makeResponse(false);
    const req = makeRequest();

    await ErrorHandler(
      res as unknown as express.Response,
      req,
      new Error(
        'Knex: Timeout acquiring a connection. The pool is probably full.'
      )
    );

    expect(res.statusCode).toBe(500);
    const body = res.body as { code: string; message: string };
    expect(body.message).not.toContain('Knex');
    errorSpy.mockRestore();
  });

  test('a SQLSTATE-coded database error responds 500 with a generic body', async () => {
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    const res = makeResponse(false);
    const req = makeRequest();

    const dbError = Object.assign(
      new Error('null value in column "user_id" violates not-null constraint'),
      { code: '23502' }
    );
    await ErrorHandler(res as unknown as express.Response, req, dbError);

    expect(res.statusCode).toBe(500);
    const body = res.body as { code: string; message: string };
    expect(body.message).not.toContain('user_id');
    errorSpy.mockRestore();
  });

  test('a malformed-JSON body error keeps its 400 and message', async () => {
    const res = makeResponse(false);
    const req = makeRequest();

    const parseError = Object.assign(
      new SyntaxError('Unexpected token < in JSON at position 0'),
      { type: 'entity.parse.failed' }
    );
    await ErrorHandler(res as unknown as express.Response, req, parseError);

    expect(res.statusCode).toBe(400);
  });
});
