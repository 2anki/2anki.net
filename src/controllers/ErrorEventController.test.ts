import { vi, type Mocked } from 'vitest';
import { Request, Response } from 'express';
import { ErrorEventController } from './ErrorEventController';
import { RateLimiter } from '../lib/rateLimit/InMemoryRateLimiter';
import { IngestErrorEventUseCase } from '../usecases/events/IngestErrorEventUseCase';

function makeIngestUseCase(
  result: 'accepted' | 'duplicate' = 'accepted'
): IngestErrorEventUseCase {
  return {
    execute: vi.fn(async () => result),
  } as unknown as IngestErrorEventUseCase;
}

function makeRes(): Mocked<
  Pick<Response, 'status' | 'json' | 'end' | 'set'>
> & {
  _statusCode?: number;
  _body?: unknown;
  _headers: Record<string, string>;
} {
  const res = {
    _statusCode: 0,
    _body: undefined as unknown,
    _headers: {} as Record<string, string>,
    status(code: number) {
      this._statusCode = code;
      return this;
    },
    json(body: unknown) {
      this._body = body;
      return this;
    },
    set(name: string, value: string) {
      this._headers[name] = value;
      return this;
    },
    end() {
      return this;
    },
  };
  return res as unknown as Mocked<
    Pick<Response, 'status' | 'json' | 'end' | 'set'>
  > & {
    _statusCode?: number;
    _body?: unknown;
    _headers: Record<string, string>;
  };
}

function makeReq(body: unknown, remoteAddress = '127.0.0.1'): Request {
  return {
    body,
    headers: {},
    socket: { remoteAddress },
  } as unknown as Request;
}

const VALID_BODY = {
  message: 'TypeError: x is null',
  stack: 'at foo.ts:5',
  url: 'https://2anki.net',
  userAgent: 'Mozilla/5.0',
  release: 'abc12345',
};

describe('ErrorEventController.ingest', () => {
  it('returns 202 on a valid payload', async () => {
    const controller = new ErrorEventController(makeIngestUseCase());
    const res = makeRes();
    await controller.ingest(makeReq(VALID_BODY), res as unknown as Response);
    expect(res._statusCode).toBe(202);
  });

  it('returns 400 on missing message', async () => {
    const controller = new ErrorEventController(makeIngestUseCase());
    const res = makeRes();
    await controller.ingest(
      makeReq({ stack: 'foo' }),
      res as unknown as Response
    );
    expect(res._statusCode).toBe(400);
  });

  it('returns 400 on null body', async () => {
    const controller = new ErrorEventController(makeIngestUseCase());
    const res = makeRes();
    await controller.ingest(makeReq(null), res as unknown as Response);
    expect(res._statusCode).toBe(400);
  });

  it('returns 413 on oversized payload', async () => {
    const controller = new ErrorEventController(makeIngestUseCase());
    const res = makeRes();
    await controller.ingest(
      makeReq({ message: 'x'.repeat(11_000) }),
      res as unknown as Response
    );
    expect(res._statusCode).toBe(413);
  });

  it('returns 429 when rate limiter denies the request', async () => {
    const exhaustedLimiter: RateLimiter = { check: () => false };
    const controller = new ErrorEventController(
      makeIngestUseCase(),
      exhaustedLimiter
    );
    const res = makeRes();
    await controller.ingest(makeReq(VALID_BODY), res as unknown as Response);
    expect(res._statusCode).toBe(429);
  });

  it('sets Retry-After: 60 on a 429 response', async () => {
    const exhaustedLimiter: RateLimiter = { check: () => false };
    const controller = new ErrorEventController(
      makeIngestUseCase(),
      exhaustedLimiter
    );
    const res = makeRes();
    await controller.ingest(makeReq(VALID_BODY), res as unknown as Response);
    expect(res._headers['Retry-After']).toBe('60');
  });

  it('does not call the use case when the rate limit is exceeded', async () => {
    const useCase = makeIngestUseCase();
    const exhaustedLimiter: RateLimiter = { check: () => false };
    const controller = new ErrorEventController(useCase, exhaustedLimiter);
    const res = makeRes();
    await controller.ingest(makeReq(VALID_BODY), res as unknown as Response);
    expect(useCase.execute).not.toHaveBeenCalled();
  });

  it.each([
    'Mozilla/5.0 (compatible; Applebot/0.1; +http://www.apple.com/go/applebot)',
    'Leikibot/2.0 (+https://leiki.com)',
    'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
    'SomeCrawler/1.0',
    'BaiduSpider/3.0',
    'Yahoo! Slurp',
  ])(
    'responds 202 without storing when user agent is %s',
    async (userAgent) => {
      const useCase = makeIngestUseCase();
      const controller = new ErrorEventController(useCase);
      const res = makeRes();
      await controller.ingest(
        makeReq({ ...VALID_BODY, userAgent }),
        res as unknown as Response
      );
      expect(res._statusCode).toBe(202);
      expect(useCase.execute).not.toHaveBeenCalled();
    }
  );

  it('stores events from a normal browser user agent', async () => {
    const useCase = makeIngestUseCase();
    const controller = new ErrorEventController(useCase);
    const res = makeRes();
    await controller.ingest(
      makeReq({
        ...VALID_BODY,
        userAgent:
          'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15',
      }),
      res as unknown as Response
    );
    expect(res._statusCode).toBe(202);
    expect(useCase.execute).toHaveBeenCalledTimes(1);
  });

  it('stores events when the user agent is absent', async () => {
    const useCase = makeIngestUseCase();
    const controller = new ErrorEventController(useCase);
    const res = makeRes();
    await controller.ingest(
      makeReq({ message: 'TypeError: x is null' }),
      res as unknown as Response
    );
    expect(res._statusCode).toBe(202);
    expect(useCase.execute).toHaveBeenCalledTimes(1);
  });

  it('falls back to the Referer header when the payload has no url', async () => {
    const useCase = makeIngestUseCase();
    const controller = new ErrorEventController(useCase);
    const req = makeReq({ message: 'TypeError: x is null' });
    (req.headers as Record<string, string>).referer =
      'https://2anki.net/upload';
    await controller.ingest(req, makeRes() as unknown as Response);
    expect(useCase.execute).toHaveBeenCalledWith(
      expect.objectContaining({
        payload: expect.objectContaining({ url: 'https://2anki.net/upload' }),
      })
    );
  });

  it('keeps the payload url when both payload url and Referer are present', async () => {
    const useCase = makeIngestUseCase();
    const controller = new ErrorEventController(useCase);
    const req = makeReq(VALID_BODY);
    (req.headers as Record<string, string>).referer = 'https://2anki.net/other';
    await controller.ingest(req, makeRes() as unknown as Response);
    expect(useCase.execute).toHaveBeenCalledWith(
      expect.objectContaining({
        payload: expect.objectContaining({ url: 'https://2anki.net' }),
      })
    );
  });

  it('leaves url null when neither payload url nor Referer is present', async () => {
    const useCase = makeIngestUseCase();
    const controller = new ErrorEventController(useCase);
    await controller.ingest(
      makeReq({ message: 'TypeError: x is null' }),
      makeRes() as unknown as Response
    );
    expect(useCase.execute).toHaveBeenCalledWith(
      expect.objectContaining({
        payload: expect.objectContaining({ url: null }),
      })
    );
  });

  it('truncates an over-long release to 40 chars', async () => {
    const useCase = makeIngestUseCase();
    const executeSpy = vi.spyOn(useCase, 'execute');
    const controller = new ErrorEventController(useCase);
    const res = makeRes();
    await controller.ingest(
      makeReq({ ...VALID_BODY, release: 'a'.repeat(100) }),
      res as unknown as Response
    );
    const callArg = executeSpy.mock.calls[0][0] as {
      payload: { release: string | null };
    };
    expect(callArg.payload.release).toBe('a'.repeat(40));
  });

  it('does not expose the raw IP in the response', async () => {
    const useCase = makeIngestUseCase();
    const executeSpy = vi.spyOn(useCase, 'execute');
    const controller = new ErrorEventController(useCase);
    const res = makeRes();
    await controller.ingest(
      makeReq(VALID_BODY, '192.168.1.1'),
      res as unknown as Response
    );
    const callArg = executeSpy.mock.calls[0][0] as {
      ipHash: string;
      payload: unknown;
    };
    expect(callArg.ipHash).not.toBe('192.168.1.1');
    expect(callArg.ipHash).toHaveLength(64);
  });
});
