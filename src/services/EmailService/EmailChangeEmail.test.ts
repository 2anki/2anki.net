const send = jest.fn().mockResolvedValue([{ statusCode: 202 }, {}]);

jest.mock('@sendgrid/mail', () => ({
  setApiKey: jest.fn(),
  send,
}));

import { getDefaultEmailService } from './EmailService';

describe('EmailService email-change mails', () => {
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

  it('sends the confirmation to the new address with the confirm link', async () => {
    const service = getDefaultEmailService();

    await service.sendEmailChangeConfirmationEmail(
      'new@example.com',
      'https://2anki.net/account/email-change?token=abc'
    );

    const msg = lastMessage();
    expect(msg.to).toBe('new@example.com');
    expect(msg.subject).toBe('Confirm your new 2anki email');
    expect(msg.html).toContain(
      'https://2anki.net/account/email-change?token=abc'
    );
    expect(msg.text).toContain(
      'https://2anki.net/account/email-change?token=abc'
    );
  });

  it('sends the notice to the old address naming the new email', async () => {
    const service = getDefaultEmailService();

    await service.sendEmailChangeNotificationEmail(
      'old@example.com',
      'new@example.com'
    );

    const msg = lastMessage();
    expect(msg.to).toBe('old@example.com');
    expect(msg.subject).toBe('A change to your 2anki email was requested');
    expect(msg.html).toContain('new@example.com');
    expect(msg.text).toContain('new@example.com');
  });
});
