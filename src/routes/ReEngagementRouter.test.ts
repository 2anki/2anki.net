import { vi, type Mocked } from 'vitest';
import express from 'express';
import http from 'node:http';
import { AddressInfo } from 'node:net';

import type { IReEngagementRepository } from '../data_layer/ReEngagementRepository';
import type { IEmailPreferencesRepository } from '../data_layer/EmailPreferencesRepository';

const mockRepo: Mocked<IReEngagementRepository> = {
  hasBeenSent: vi.fn().mockResolvedValue(false),
  recordSend: vi.fn().mockResolvedValue(1),
  saveResponse: vi.fn().mockResolvedValue(undefined),
  findByToken: vi.fn().mockResolvedValue(null),
  getUsersToEmail: vi.fn().mockResolvedValue([]),
};

const mockPrefRepo: Mocked<IEmailPreferencesRepository> = {
  isOptedOut: vi.fn().mockResolvedValue(false),
  optOut: vi.fn().mockResolvedValue(undefined),
  optIn: vi.fn().mockResolvedValue(undefined),
};

vi.mock('../data_layer', () => ({ getDatabase: vi.fn() }));
vi.mock('../data_layer/ReEngagementRepository', () => ({
  __esModule: true,
  default: vi.fn().mockImplementation(function () {
    return mockRepo;
  }),
}));
vi.mock('../data_layer/EmailPreferencesRepository', () => ({
  __esModule: true,
  default: vi.fn().mockImplementation(function () {
    return mockPrefRepo;
  }),
}));

async function buildServer() {
  const { default: ReEngagementRouter } = await import('./ReEngagementRouter');
  const app = express();
  app.use(express.json());
  app.use(ReEngagementRouter());
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const { port } = server.address() as AddressInfo;
  return { server, url: `http://127.0.0.1:${port}` };
}

describe('ReEngagementRouter', () => {
  let server: http.Server;
  let url: string;

  beforeAll(async () => {
    ({ server, url } = await buildServer());
  });

  afterAll(() => server.close());

  beforeEach(() => vi.clearAllMocks());

  describe('GET /feedback/onboarding', () => {
    it('returns 400 when uid is missing', async () => {
      const res = await fetch(`${url}/feedback/onboarding`);
      expect(res.status).toBe(400);
    });

    it('returns 404 when token is unknown', async () => {
      const res = await fetch(`${url}/feedback/onboarding?uid=bad`);
      expect(res.status).toBe(404);
    });

    it('returns 200 with emailId when token is valid', async () => {
      mockRepo.findByToken.mockResolvedValueOnce({ id: 7, userId: 2 });
      const res = await fetch(`${url}/feedback/onboarding?uid=valid`);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toMatchObject({ valid: true, emailId: 7 });
    });
  });

  describe('POST /feedback/onboarding', () => {
    it('returns 400 when required fields are missing', async () => {
      const res = await fetch(`${url}/feedback/onboarding`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ stoppedReason: 'Other' }),
      });
      expect(res.status).toBe(400);
    });

    it('returns 404 when token is not found', async () => {
      const res = await fetch(`${url}/feedback/onboarding`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          token: 'bad',
          stoppedReason: 'Other',
          contentType: 'Notion',
        }),
      });
      expect(res.status).toBe(404);
    });

    it('returns 200 when token is valid', async () => {
      mockRepo.findByToken.mockResolvedValueOnce({ id: 3, userId: 9 });
      const res = await fetch(`${url}/feedback/onboarding`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          token: 'valid',
          stoppedReason: 'Just browsing',
          contentType: 'PDF',
        }),
      });
      expect(res.status).toBe(200);
    });
  });

  describe('GET /unsubscribe', () => {
    it('returns 400 when uid is missing', async () => {
      const res = await fetch(`${url}/unsubscribe`);
      expect(res.status).toBe(400);
    });

    it('returns 404 when token is unknown', async () => {
      const res = await fetch(`${url}/unsubscribe?uid=ghost`);
      expect(res.status).toBe(404);
    });

    it('returns 200 when token is valid and calls optOut', async () => {
      mockRepo.findByToken.mockResolvedValueOnce({ id: 11, userId: 4 });
      const res = await fetch(`${url}/unsubscribe?uid=unsub-token`);
      expect(res.status).toBe(200);
      expect(mockPrefRepo.optOut).toHaveBeenCalledWith(4);
    });
  });
});
