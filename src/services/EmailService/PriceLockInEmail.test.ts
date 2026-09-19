const send = jest.fn().mockResolvedValue([{ statusCode: 202 }, {}]);

jest.mock('@sendgrid/mail', () => ({
  setApiKey: jest.fn(),
  send,
}));

import { getDefaultEmailService } from './EmailService';
import { PRICE_LOCK_IN_TEMPLATE } from './constants';

describe('EmailService.sendPriceLockInEmail', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    jest.clearAllMocks();
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

  it('loads the template with the required structure', () => {
    expect(PRICE_LOCK_IN_TEMPLATE).toContain(
      '2anki.net/mascot/navbar-logo.png'
    );
    expect(PRICE_LOCK_IN_TEMPLATE).toContain('{{ctaUrl}}');
    expect(PRICE_LOCK_IN_TEMPLATE).toContain('{{unsubscribeUrl}}');
    expect(PRICE_LOCK_IN_TEMPLATE).toContain(
      '2anki.net — Turn what you study into Anki flashcards'
    );
    expect(PRICE_LOCK_IN_TEMPLATE).toContain('Lock in $6/month');
  });

  it('uses subject A for variant a', async () => {
    const service = getDefaultEmailService();

    await service.sendPriceLockInEmail('user@example.com', 'tok-a', 'a');

    expect(lastMessage().subject).toBe('Lock in $6/month before prices go up');
  });

  it('uses subject B for variant b', async () => {
    const service = getDefaultEmailService();

    await service.sendPriceLockInEmail('user@example.com', 'tok-b', 'b');

    expect(lastMessage().subject).toBe(
      'Your current rate is grandfathered until Sunday'
    );
  });

  it('points the CTA at the pricing redirect with the token', async () => {
    const service = getDefaultEmailService();

    await service.sendPriceLockInEmail('user@example.com', 'tok-cta', 'a');

    const msg = lastMessage();
    expect(msg.html).toContain(
      'https://2anki.net/r/email?t=tok-cta&c=price_lock_in&to=/pricing'
    );
    expect(msg.html).not.toContain('{{ctaUrl}}');
  });

  it('keeps a working unsubscribe link', async () => {
    const service = getDefaultEmailService();

    await service.sendPriceLockInEmail('user@example.com', 'tok-unsub', 'b');

    const msg = lastMessage();
    expect(msg.html).toContain('https://2anki.net/unsubscribe?uid=tok-unsub');
    expect(msg.html).not.toContain('{{unsubscribeUrl}}');
  });

  it('includes the lock-in copy and the team sign-off', async () => {
    const service = getDefaultEmailService();

    await service.sendPriceLockInEmail('user@example.com', 'tok', 'a');

    const msg = lastMessage();
    expect(msg.html).toContain('Pro pricing has gone up for new members');
    expect(msg.html).toContain('The 2anki Team');
    expect(msg.text).toContain('Pro pricing has gone up for new members');
  });
});
