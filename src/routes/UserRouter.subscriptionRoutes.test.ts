import { vi } from 'vitest';

vi.mock('../data_layer', () => ({
  getDatabase: vi.fn(() => ({})),
}));

vi.mock('../services/EmailService/EmailService', () => ({
  getDefaultEmailService: vi.fn(() => ({})),
}));

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
