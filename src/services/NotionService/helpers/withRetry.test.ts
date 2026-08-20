import {
  APIErrorCode,
  APIResponseError,
  RequestTimeoutError,
  UnknownHTTPResponseError,
} from '@notionhq/client';
import { withRetry } from './withRetry';

function makeApiError(
  code: APIErrorCode,
  status = 500,
  headers: Record<string, string> = {}
): APIResponseError {
  const err = new Error('api') as any;
  Object.setPrototypeOf(err, APIResponseError.prototype);
  err.code = code;
  err.status = status;
  err.name = 'APIResponseError';
  err.headers = headers;
  return err as APIResponseError;
}

function makeUnknownHttpError(status: number): UnknownHTTPResponseError {
  const err = new Error('unknown http') as any;
  Object.setPrototypeOf(err, UnknownHTTPResponseError.prototype);
  err.code = 'notionhq_client_response_error';
  err.status = status;
  err.name = 'UnknownHTTPResponseError';
  err.headers = {};
  return err as UnknownHTTPResponseError;
}

function makeRequestTimeoutError(): RequestTimeoutError {
  const err = new Error('request to Notion API timed out') as any;
  Object.setPrototypeOf(err, RequestTimeoutError.prototype);
  err.code = 'notionhq_client_request_timeout';
  err.name = 'RequestTimeoutError';
  return err as RequestTimeoutError;
}

describe('withRetry', () => {
  it('returns the result when the operation succeeds on the first try', async () => {
    const fn = jest.fn().mockResolvedValue('ok');
    const result = await withRetry(fn, { maxAttempts: 3, baseDelayMs: 1 });
    expect(result).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('retries on rate_limited and eventually succeeds', async () => {
    const fn = jest
      .fn()
      .mockRejectedValueOnce(makeApiError(APIErrorCode.RateLimited, 429))
      .mockResolvedValueOnce('ok');
    const result = await withRetry(fn, { maxAttempts: 3, baseDelayMs: 1 });
    expect(result).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('retries on internal_server_error', async () => {
    const fn = jest
      .fn()
      .mockRejectedValueOnce(
        makeApiError(APIErrorCode.InternalServerError, 500)
      )
      .mockResolvedValueOnce('ok');
    await withRetry(fn, { maxAttempts: 3, baseDelayMs: 1 });
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('retries on network errors (no response)', async () => {
    const networkError: any = new Error('ECONNRESET');
    networkError.code = 'ECONNRESET';
    const fn = jest
      .fn()
      .mockRejectedValueOnce(networkError)
      .mockResolvedValueOnce('ok');
    await withRetry(fn, { maxAttempts: 3, baseDelayMs: 1 });
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('retries on a 502 bad gateway (UnknownHTTPResponseError)', async () => {
    const fn = jest
      .fn()
      .mockRejectedValueOnce(makeUnknownHttpError(502))
      .mockResolvedValueOnce('ok');
    await withRetry(fn, { maxAttempts: 3, baseDelayMs: 1 });
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('retries on a 504 gateway timeout (UnknownHTTPResponseError)', async () => {
    const fn = jest
      .fn()
      .mockRejectedValueOnce(makeUnknownHttpError(504))
      .mockResolvedValueOnce('ok');
    await withRetry(fn, { maxAttempts: 3, baseDelayMs: 1 });
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('does NOT retry a 4xx UnknownHTTPResponseError', async () => {
    const err = makeUnknownHttpError(400);
    const fn = jest.fn().mockRejectedValue(err);
    await expect(
      withRetry(fn, { maxAttempts: 3, baseDelayMs: 1 })
    ).rejects.toBe(err);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('retries an axios 503 response and eventually succeeds', async () => {
    const axiosError = Object.assign(
      new Error('Request failed with status code 503'),
      { isAxiosError: true, response: { status: 503 } }
    );
    const fn = jest
      .fn()
      .mockRejectedValueOnce(axiosError)
      .mockResolvedValueOnce('ok');
    await withRetry(fn, { maxAttempts: 3, baseDelayMs: 1 });
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('retries an axios error with no response (transport failure)', async () => {
    const axiosError = Object.assign(new Error('socket hang up'), {
      isAxiosError: true,
      code: 'ERR_NETWORK',
    });
    const fn = jest
      .fn()
      .mockRejectedValueOnce(axiosError)
      .mockResolvedValueOnce('ok');
    await withRetry(fn, { maxAttempts: 3, baseDelayMs: 1 });
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('does NOT retry an axios 4xx response (consumed/invalid auth code)', async () => {
    const axiosError = Object.assign(
      new Error('Request failed with status code 400'),
      {
        isAxiosError: true,
        response: { status: 400, data: { error: 'invalid_grant' } },
      }
    );
    const fn = jest.fn().mockRejectedValue(axiosError);
    await expect(
      withRetry(fn, { maxAttempts: 3, baseDelayMs: 1 })
    ).rejects.toBe(axiosError);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('retries on a Notion client RequestTimeoutError', async () => {
    const fn = jest
      .fn()
      .mockRejectedValueOnce(makeRequestTimeoutError())
      .mockResolvedValueOnce('ok');
    await withRetry(fn, { maxAttempts: 3, baseDelayMs: 1 });
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('does NOT retry on unauthorized', async () => {
    const err = makeApiError(APIErrorCode.Unauthorized, 401);
    const fn = jest.fn().mockRejectedValue(err);
    await expect(
      withRetry(fn, { maxAttempts: 3, baseDelayMs: 1 })
    ).rejects.toBe(err);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('does NOT retry on object_not_found', async () => {
    const err = makeApiError(APIErrorCode.ObjectNotFound, 404);
    const fn = jest.fn().mockRejectedValue(err);
    await expect(
      withRetry(fn, { maxAttempts: 3, baseDelayMs: 1 })
    ).rejects.toBe(err);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('does NOT retry on validation_error', async () => {
    const err = makeApiError(APIErrorCode.ValidationError, 400);
    const fn = jest.fn().mockRejectedValue(err);
    await expect(
      withRetry(fn, { maxAttempts: 3, baseDelayMs: 1 })
    ).rejects.toBe(err);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('gives up after maxAttempts retryable failures and throws the last error', async () => {
    const err = makeApiError(APIErrorCode.InternalServerError, 500);
    const fn = jest.fn().mockRejectedValue(err);
    await expect(
      withRetry(fn, { maxAttempts: 3, baseDelayMs: 1 })
    ).rejects.toBe(err);
    expect(fn).toHaveBeenCalledTimes(3);
  });

  describe('Retry-After header', () => {
    it('waits the Retry-After integer seconds when header is present on 429', async () => {
      const sleepFn = jest.fn().mockResolvedValue(undefined);
      const err = makeApiError(APIErrorCode.RateLimited, 429, {
        'retry-after': '7',
      });
      const fn = jest
        .fn()
        .mockRejectedValueOnce(err)
        .mockResolvedValueOnce('ok');

      await withRetry(fn, { maxAttempts: 3, baseDelayMs: 1000, sleepFn });

      expect(sleepFn).toHaveBeenCalledWith(7000);
    });

    it('falls through to exponential backoff when Retry-After header is missing', async () => {
      const sleepFn = jest.fn().mockResolvedValue(undefined);
      const err = makeApiError(APIErrorCode.RateLimited, 429);
      const fn = jest
        .fn()
        .mockRejectedValueOnce(err)
        .mockResolvedValueOnce('ok');

      await withRetry(fn, { maxAttempts: 3, baseDelayMs: 100, sleepFn });

      const delayUsed = (sleepFn.mock.calls[0] as [number])[0];
      expect(delayUsed).toBeGreaterThanOrEqual(50);
      expect(delayUsed).toBeLessThanOrEqual(300);
    });

    it('clamps Retry-After values above 30s to 30s', async () => {
      const sleepFn = jest.fn().mockResolvedValue(undefined);
      const err = makeApiError(APIErrorCode.RateLimited, 429, {
        'retry-after': '120',
      });
      const fn = jest
        .fn()
        .mockRejectedValueOnce(err)
        .mockResolvedValueOnce('ok');

      await withRetry(fn, { maxAttempts: 3, baseDelayMs: 1000, sleepFn });

      expect(sleepFn).toHaveBeenCalledWith(30000);
    });
  });
});
