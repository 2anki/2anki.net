import { vi } from 'vitest';
const send = vi.hoisted(() =>
  vi.fn().mockResolvedValue([{ statusCode: 202 }, {}])
);

vi.mock('@sendgrid/mail', () => {
  const sgMailMock = { setApiKey: vi.fn(), send };
  return { ...sgMailMock, default: sgMailMock };
});

import { getDefaultEmailService } from './EmailService';
import { SUBSCRIPTION_RECOVERY_TEMPLATE } from './constants';

describe('EmailService.sendSubscriptionRecoveryEmail', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.SENDGRID_API_KEY = 'test-key';
    process.env.DOMAIN = 'https://2anki.net';
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  function lastMessage() {
    const calls = send.mock.calls;
    return calls[calls.length - 1][0] as {
      to: string;
      subject: string;
      html: string;
      text: string;
    };
  }

  it('loads the template with the shared structure and no unsubscribe link', () => {
    expect(SUBSCRIPTION_RECOVERY_TEMPLATE).toContain(
      '2anki.net/mascot/navbar-logo.png'
    );
    expect(SUBSCRIPTION_RECOVERY_TEMPLATE).toContain(
      '2anki.net — Turn what you study into Anki flashcards'
    );
    expect(SUBSCRIPTION_RECOVERY_TEMPLATE).not.toContain('{{unsubscribeUrl}}');
  });

  it('sends to the paid email and fills the register and account urls', async () => {
    const service = getDefaultEmailService();

    await service.sendSubscriptionRecoveryEmail(
      'payer@example.com',
      'payer@example.com'
    );

    const msg = lastMessage();
    expect(msg.to).toBe('payer@example.com');
    expect(msg.html).toContain('https://2anki.net/register');
    expect(msg.html).toContain('https://2anki.net/account');
    expect(msg.html).toContain('payer@example.com');
    expect(msg.html).not.toContain('{{paidEmail}}');
    expect(msg.html).not.toContain('{{registerUrl}}');
    expect(msg.html).not.toContain('{{accountUrl}}');
  });

  it('carries the recovery subject and the team sign-off', async () => {
    const service = getDefaultEmailService();

    await service.sendSubscriptionRecoveryEmail(
      'payer@example.com',
      'payer@example.com'
    );

    const msg = lastMessage();
    expect(msg.subject).toBe(
      "Your 2anki payment isn't linked to an account yet"
    );
    expect(msg.html).toContain('The 2anki Team');
  });
});
