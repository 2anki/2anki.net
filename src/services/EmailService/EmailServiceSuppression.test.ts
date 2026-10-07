import { vi } from 'vitest';
const send = vi.hoisted(() =>
  vi.fn().mockResolvedValue([{ statusCode: 202 }, {}])
);

vi.mock('@sendgrid/mail', () => {
  const sgMailMock = { setApiKey: vi.fn(), send };
  return { ...sgMailMock, default: sgMailMock };
});

import { EmailService } from './EmailService';
import { DEFAULT_SENDER } from './constants';

describe('EmailService suppression gate', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.DOMAIN = 'https://2anki.net';
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('does not call SendGrid when the recipient is suppressed', async () => {
    const isSuppressed = vi.fn().mockResolvedValue(true);
    const service = new EmailService('test-key', DEFAULT_SENDER, isSuppressed);

    await service.sendResetEmail('blocked@example.com', 'tok-1');

    expect(isSuppressed).toHaveBeenCalledWith('blocked@example.com');
    expect(send).not.toHaveBeenCalled();
  });

  it('sends when the recipient is not suppressed', async () => {
    const isSuppressed = vi.fn().mockResolvedValue(false);
    const service = new EmailService('test-key', DEFAULT_SENDER, isSuppressed);

    await service.sendResetEmail('ok@example.com', 'tok-1');

    expect(send).toHaveBeenCalledTimes(1);
    const msg = send.mock.calls[0][0] as { to: string };
    expect(msg.to).toBe('ok@example.com');
  });

  it('reports suppressed for a magic link to a suppressed recipient', async () => {
    const isSuppressed = vi.fn().mockResolvedValue(true);
    const service = new EmailService('test-key', DEFAULT_SENDER, isSuppressed);

    const result = await service.sendMagicLinkEmail(
      'blocked@example.com',
      'tok-3',
      'login'
    );

    expect(result).toEqual({ suppressed: true });
    expect(send).not.toHaveBeenCalled();
  });

  it('reports not suppressed for a magic link that sends', async () => {
    const isSuppressed = vi.fn().mockResolvedValue(false);
    const service = new EmailService('test-key', DEFAULT_SENDER, isSuppressed);

    const result = await service.sendMagicLinkEmail(
      'ok@example.com',
      'tok-4',
      'login'
    );

    expect(result).toEqual({ suppressed: false });
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('sends when the suppression lookup itself fails (fail-open)', async () => {
    const isSuppressed = vi
      .fn()
      .mockRejectedValue(new Error('lookup unavailable'));
    const service = new EmailService('test-key', DEFAULT_SENDER, isSuppressed);

    await service.sendMagicLinkEmail('ok@example.com', 'tok-2', 'login');

    expect(send).toHaveBeenCalledTimes(1);
  });

  it('blocks the deck-ready conversion email for a suppressed recipient', async () => {
    const isSuppressed = vi.fn().mockResolvedValue(true);
    const service = new EmailService('test-key', DEFAULT_SENDER, isSuppressed);

    await service.sendConversionLinkEmail(
      'blocked@example.com',
      'Pharmacology',
      'https://2anki.net/d/abc'
    );

    expect(send).not.toHaveBeenCalled();
  });
});
