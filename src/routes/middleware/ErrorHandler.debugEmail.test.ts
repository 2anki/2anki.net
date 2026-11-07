import { vi } from 'vitest';
import type express from 'express';

const sendMail = vi.hoisted(() => vi.fn().mockResolvedValue({}));

vi.mock('nodemailer', () => ({
  default: { createTransport: () => ({ sendMail }) },
}));

import ErrorHandler from './ErrorHandler';

const res = () =>
  ({
    headersSent: false,
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
    send: vi.fn().mockReturnThis(),
    set: vi.fn().mockReturnThis(),
  }) as unknown as express.Response;

const req = (body: Record<string, unknown>) =>
  ({
    body,
    path: '/api/upload/retry-with-credential',
    method: 'POST',
    query: {},
    files: [],
  }) as unknown as express.Request;

describe('ErrorHandler debug email', () => {
  beforeEach(() => {
    sendMail.mockClear();
    vi.stubEnv('NODE_ENV', 'production');
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'info').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('keeps the PDF password out of the email', async () => {
    await ErrorHandler(
      res(),
      req({
        'share-files-for-debugging': 'true',
        credential: 'pdf-secret',
        deck: 'Biology',
      }),
      new Error('conversion broke')
    );

    const message = sendMail.mock.calls[0][0] as { text: string };
    expect(message.text).not.toContain('pdf-secret');
    expect(message.text).toContain('Biology');
  });

  it('keeps a secret in the query out of the email', async () => {
    const request = req({ 'share-files-for-debugging': 'true' });
    Object.assign(request, { query: { token: 'query-secret' } });

    await ErrorHandler(res(), request, new Error('conversion broke'));

    const message = sendMail.mock.calls[0][0] as { text: string };
    expect(message.text).not.toContain('query-secret');
  });

  it('keeps the Drive token out when the opt-in came from stored options, on an MCP request with no path or query', async () => {
    await ErrorHandler(
      res(),
      {
        body: {
          'share-files-for-debugging': true,
          googleDriveAuth: 'drive-secret',
        },
      } as unknown as express.Request,
      new Error('conversion broke')
    );

    const message = sendMail.mock.calls[0][0] as { text: string };
    expect(message.text).not.toContain('drive-secret');
  });

  it('sends nothing without the debugging opt-in', async () => {
    await ErrorHandler(
      res(),
      req({ credential: 'pdf-secret' }),
      new Error('conversion broke')
    );

    expect(sendMail).not.toHaveBeenCalled();
  });
});
