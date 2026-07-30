import express from 'express';
import http from 'node:http';
import { AddressInfo } from 'node:net';

import type { IInactivityEmailRepository } from '../data_layer/InactivityEmailRepository';
import type { IReEngagementRepository } from '../data_layer/ReEngagementRepository';
import type { EventsSink } from '../services/events/EventsSink';

const mockInactivityRepo: jest.Mocked<
  Pick<IInactivityEmailRepository, 'findByToken'>
> = {
  findByToken: jest.fn().mockResolvedValue(null),
};

const mockReEngagementRepo: jest.Mocked<
  Pick<IReEngagementRepository, 'findByToken'>
> = {
  findByToken: jest.fn().mockResolvedValue(null),
};

const mockSink: jest.Mocked<Pick<EventsSink, 'record'>> = {
  record: jest.fn(),
};

jest.mock('../data_layer', () => ({ getDatabase: jest.fn() }));
jest.mock('../data_layer/InactivityEmailRepository', () =>
  jest.fn().mockImplementation(() => mockInactivityRepo)
);
jest.mock('../data_layer/ReEngagementRepository', () =>
  jest.fn().mockImplementation(() => mockReEngagementRepo)
);
jest.mock('../services/events/eventsSinkInstance', () => ({
  getEventsSink: jest.fn(() => mockSink),
}));

async function buildServer() {
  const { default: EmailRedirectRouter } =
    await import('./EmailRedirectRouter');
  const app = express();
  app.use(EmailRedirectRouter());
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const { port } = server.address() as AddressInfo;
  return { server, url: `http://127.0.0.1:${port}` };
}

describe('EmailRedirectRouter', () => {
  let server: http.Server;
  let url: string;

  beforeAll(async () => {
    process.env.DOMAIN = 'https://2anki.net';
    ({ server, url } = await buildServer());
  });

  afterAll(() => server.close());

  beforeEach(() => jest.clearAllMocks());

  describe('GET /r/email', () => {
    it('redirects to / when to param is absent', async () => {
      const res = await fetch(`${url}/r/email?t=abc&c=inactivity`, {
        redirect: 'manual',
      });
      expect(res.status).toBe(302);
      expect(res.headers.get('location')).toBe('https://2anki.net/');
    });

    it('redirects to allowed destination /upload', async () => {
      const res = await fetch(`${url}/r/email?t=abc&c=inactivity&to=/upload`, {
        redirect: 'manual',
      });
      expect(res.status).toBe(302);
      expect(res.headers.get('location')).toBe('https://2anki.net/upload');
    });

    it('redirects to allowed destination /pricing', async () => {
      const res = await fetch(`${url}/r/email?t=abc&c=inactivity&to=/pricing`, {
        redirect: 'manual',
      });
      expect(res.status).toBe(302);
      expect(res.headers.get('location')).toBe('https://2anki.net/pricing');
    });

    it('redirects to allowed destination /login', async () => {
      const res = await fetch(`${url}/r/email?t=abc&c=inactivity&to=/login`, {
        redirect: 'manual',
      });
      expect(res.status).toBe(302);
      expect(res.headers.get('location')).toBe('https://2anki.net/login');
    });

    it('falls back to / for a disallowed destination', async () => {
      const res = await fetch(`${url}/r/email?t=abc&c=inactivity&to=/evil`, {
        redirect: 'manual',
      });
      expect(res.status).toBe(302);
      expect(res.headers.get('location')).toBe('https://2anki.net/');
    });

    it('falls back to / when to is an absolute URL injection', async () => {
      const res = await fetch(
        `${url}/r/email?t=abc&c=inactivity&to=https://evil.com`,
        { redirect: 'manual' }
      );
      expect(res.status).toBe(302);
      expect(res.headers.get('location')).toBe('https://2anki.net/');
    });

    it('records email_clicked with null user when inactivity token is unknown', async () => {
      mockInactivityRepo.findByToken.mockResolvedValueOnce(null);
      await fetch(`${url}/r/email?t=badtoken&c=inactivity&to=/upload`, {
        redirect: 'manual',
      });
      expect(mockSink.record).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'email_clicked',
          user_id: null,
          props: expect.objectContaining({
            campaign: 'inactivity',
            email_id: null,
          }),
        })
      );
    });

    it('records email_clicked with user_id when inactivity token resolves', async () => {
      mockInactivityRepo.findByToken.mockResolvedValueOnce({
        id: 5,
        userId: 42,
      });
      await fetch(`${url}/r/email?t=validtoken&c=inactivity&to=/upload`, {
        redirect: 'manual',
      });
      expect(mockSink.record).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'email_clicked',
          user_id: 42,
          props: expect.objectContaining({
            campaign: 'inactivity',
            email_id: 5,
          }),
        })
      );
    });

    it('records email_clicked with user_id when reengagement token resolves', async () => {
      mockReEngagementRepo.findByToken.mockResolvedValueOnce({
        id: 9,
        userId: 77,
      });
      await fetch(`${url}/r/email?t=retoken&c=reengagement&to=/`, {
        redirect: 'manual',
      });
      expect(mockSink.record).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'email_clicked',
          user_id: 77,
          props: expect.objectContaining({
            campaign: 'reengagement',
            email_id: 9,
          }),
        })
      );
    });

    it('records email_clicked with null user when campaign param is missing', async () => {
      await fetch(`${url}/r/email?t=sometoken&to=/upload`, {
        redirect: 'manual',
      });
      expect(mockSink.record).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'email_clicked',
          user_id: null,
          props: expect.objectContaining({ campaign: 'unknown' }),
        })
      );
    });

    it('still redirects when token DB lookup throws', async () => {
      mockInactivityRepo.findByToken.mockRejectedValueOnce(
        new Error('db down')
      );
      const res = await fetch(`${url}/r/email?t=abc&c=inactivity&to=/upload`, {
        redirect: 'manual',
      });
      expect(res.status).toBe(302);
    });
  });
});

describe('resolveEmailDestination', () => {
  // The redirect target must always be a string this module owns, never the
  // caller's — an off-site value reaching res.redirect is an open redirect
  // (tssecurity:S5146), and a phished 2anki email link is the realistic abuse.
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { resolveEmailDestination } = require('./EmailRedirectRouter') as {
    resolveEmailDestination: (requested: string | null) => string;
  };

  it.each(['/', '/upload', '/pricing', '/login'])(
    'passes through the allowlisted destination %s',
    (destination) => {
      expect(resolveEmailDestination(destination)).toBe(destination);
    }
  );

  it.each([
    ['https://evil.example.com', 'absolute off-site URL'],
    ['//evil.example.com', 'protocol-relative URL'],
    ['/upload/../../etc/passwd', 'traversal out of an allowed path'],
    ['/uploadX', 'prefix of an allowed path'],
    ['javascript:alert(1)', 'script scheme'],
    ['', 'empty string'],
    ['constructor', 'Object.prototype key'],
    ['__proto__', 'prototype-pollution key'],
    ['toString', 'inherited method name'],
  ])('falls back to / for %s (%s)', (requested) => {
    expect(resolveEmailDestination(requested)).toBe('/');
  });

  it('falls back to / when no destination was supplied', () => {
    expect(resolveEmailDestination(null)).toBe('/');
  });
});
