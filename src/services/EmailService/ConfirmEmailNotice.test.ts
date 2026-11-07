import { vi } from 'vitest';

const send = vi.hoisted(() =>
  vi.fn().mockResolvedValue([{ statusCode: 202 }, {}])
);

vi.mock('@sendgrid/mail', () => {
  const sgMailMock = { setApiKey: vi.fn(), send };
  return { ...sgMailMock, default: sgMailMock };
});

import { getDefaultEmailService } from './EmailService';
import { CONFIRM_EMAIL_NOTICE_TEMPLATE, EMAIL_CATEGORIES } from './constants';

describe('confirm email notice template', () => {
  it('has the shared header, footer and sign-in placeholder', () => {
    expect(CONFIRM_EMAIL_NOTICE_TEMPLATE).toContain('mascot/navbar-logo.png');
    expect(CONFIRM_EMAIL_NOTICE_TEMPLATE).toContain(
      '2anki.net — Turn what you study into Anki flashcards'
    );
    expect(CONFIRM_EMAIL_NOTICE_TEMPLATE).toContain('{{signInUrl}}');
    expect(CONFIRM_EMAIL_NOTICE_TEMPLATE).toContain('{{email}}');
  });

  it('carries none of the recovery email placeholders', () => {
    expect(CONFIRM_EMAIL_NOTICE_TEMPLATE).not.toContain('{{paidEmail}}');
    expect(CONFIRM_EMAIL_NOTICE_TEMPLATE).not.toContain('{{registerUrl}}');
  });

  it('has its own delivery category', () => {
    expect(EMAIL_CATEGORIES.confirmEmailNotice).toBe('confirm-email-notice');
  });
});

describe('EmailService.sendConfirmEmailNotice', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.SENDGRID_API_KEY = 'test-key';
    process.env.DOMAIN = 'https://2anki.net';
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('fills the sign-in link and the address, and reports it delivered', async () => {
    const delivered =
      await getDefaultEmailService().sendConfirmEmailNotice('payer@x.test');

    const msg = send.mock.calls[0][0] as { to: string; html: string };
    expect(delivered).toBe(true);
    expect(msg.to).toBe('payer@x.test');
    expect(msg.html).toContain('href="https://2anki.net/login"');
    expect(msg.html).toContain('payer@x.test');
    expect(msg.html).not.toContain('{{');
  });

  it('warns about the password, other sessions and connected apps', () => {
    expect(CONFIRM_EMAIL_NOTICE_TEMPLATE).toContain(
      'signs you out everywhere else and disconnects apps connected to your 2anki account'
    );
    expect(CONFIRM_EMAIL_NOTICE_TEMPLATE).toContain('Forgot your password?');
  });

  it('tells someone already signed in to sign out first', () => {
    expect(CONFIRM_EMAIL_NOTICE_TEMPLATE).toContain('sign out first');
  });
});
