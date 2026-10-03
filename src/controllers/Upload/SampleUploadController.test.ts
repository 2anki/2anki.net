import express from 'express';

import { SampleUploadController } from './SampleUploadController';
import { ConvertSampleDeckUseCase } from '../../usecases/uploads/ConvertSampleDeckUseCase';
import { RateLimiter } from '../../lib/rateLimit/InMemoryRateLimiter';
import { track } from '../../services/events/track';

jest.mock('../../services/events/track', () => ({ track: jest.fn() }));

const mockTrack = track as jest.Mock;

function fakeUseCase(cardCount = 8): ConvertSampleDeckUseCase {
  return {
    execute: jest.fn().mockResolvedValue({
      apkg: Buffer.from('SAMPLE-APKG'),
      cardCount,
      deckName: 'Sample deck — Biology 101',
    }),
  } as unknown as ConvertSampleDeckUseCase;
}

interface FakeResponse {
  statusCode: number;
  body: unknown;
  headers: Record<string, string>;
  set: jest.Mock;
  status: jest.Mock;
  attachment: jest.Mock;
  send: jest.Mock;
  json: jest.Mock;
}

function fakeResponse(): FakeResponse {
  const headers: Record<string, string> = {};
  const res: FakeResponse = {
    statusCode: 200,
    body: undefined,
    headers,
    set: jest.fn((key: string, value: string) => {
      headers[key] = value;
      return res;
    }),
    status: jest.fn((code: number) => {
      res.statusCode = code;
      return res;
    }),
    attachment: jest.fn(() => res),
    send: jest.fn((payload: unknown) => {
      res.body = payload;
      return res;
    }),
    json: jest.fn((payload: unknown) => {
      res.body = payload;
      return res;
    }),
  };
  return res;
}

const allowingLimiter: RateLimiter = { check: () => true };
const denyingLimiter: RateLimiter = { check: () => false };

const req = { cookies: { anon_id: 'anon-123' } } as unknown as express.Request;

beforeEach(() => mockTrack.mockClear());

describe('SampleUploadController', () => {
  it('returns the apkg with the same headers the file endpoint sets', async () => {
    const useCase = fakeUseCase(8);
    const controller = new SampleUploadController(useCase, allowingLimiter);
    const res = fakeResponse();

    await controller.sample(req, res as unknown as express.Response);

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual(Buffer.from('SAMPLE-APKG'));
    expect(res.headers['Content-Type']).toBe('application/apkg');
    expect(res.headers['X-Card-Count']).toBe('8');
    expect(res.headers['File-Name']).toBe(
      encodeURIComponent('Sample deck — Biology 101')
    );
    expect(res.headers['Access-Control-Expose-Headers']).toContain(
      'X-Card-Count'
    );
  });

  it('records a dedicated sample event tagged source=sample, not the real-funnel event', async () => {
    const controller = new SampleUploadController(
      fakeUseCase(8),
      allowingLimiter
    );
    const res = fakeResponse();

    await controller.sample(req, res as unknown as express.Response);

    expect(mockTrack).toHaveBeenCalledWith('sample_conversion_succeeded', {
      anonymousId: 'anon-123',
      props: { source: 'sample', card_count: 8 },
    });
    expect(mockTrack).not.toHaveBeenCalledWith(
      'conversion_succeeded',
      expect.anything()
    );
  });

  it('refuses with 429 when the rate limiter is exhausted and does not convert', async () => {
    const useCase = fakeUseCase(8);
    const controller = new SampleUploadController(useCase, denyingLimiter);
    const res = fakeResponse();

    await controller.sample(req, res as unknown as express.Response);

    expect(res.statusCode).toBe(429);
    expect(useCase.execute as jest.Mock).not.toHaveBeenCalled();
    expect(res.headers['Retry-After']).toBe('60');
  });
});
