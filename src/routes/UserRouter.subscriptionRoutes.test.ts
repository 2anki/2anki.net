import { vi } from 'vitest';

vi.mock('../data_layer', () => ({
  getDatabase: vi.fn(() => ({})),
}));

vi.mock('../services/EmailService/EmailService', () => ({
  getDefaultEmailService: vi.fn(() => ({})),
}));

import express from 'express';
import http from 'node:http';
import { AddressInfo } from 'node:net';
import UserRouter from './UserRouter';

interface RouteLayer {
  route?: { path: string; methods: Record<string, boolean> };
}

const postPaths = (): string[] => {
  const stack = (UserRouter() as unknown as { stack: RouteLayer[] }).stack;
  return stack
    .filter((layer) => layer.route?.methods.post === true)
    .map((layer) => layer.route?.path ?? '');
};

describe('UserRouter subscription lifecycle routes', () => {
  it('no longer exposes a route that starts a new pause', () => {
    expect(postPaths()).not.toContain('/api/users/pause-subscription');
  });

  it('keeps resume for subscribers who are already paused', () => {
    expect(postPaths()).toContain('/api/users/resume-subscription');
  });

  it('keeps the cancel routes', () => {
    expect(postPaths()).toEqual(
      expect.arrayContaining([
        '/api/users/cancel-subscription',
        '/api/users/cancellation-feedback',
      ])
    );
  });
});

describe('UserRouter Auto Sync access requests', () => {
  let server: http.Server;
  let url: string;

  beforeAll(async () => {
    const app = express();
    app.use(UserRouter());
    server = http.createServer(app);
    await new Promise<void>((resolve) => server.listen(0, resolve));
    url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(() => server.close());

  it('answers 404, since Auto Sync is no longer switched on by request', async () => {
    const res = await fetch(`${url}/api/users/request-hosted-anki-access`, {
      method: 'POST',
      headers: { cookie: 'token=a-session-token' },
    });

    expect(res.status).toBe(404);
  });
});
