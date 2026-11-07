import { CONFIRM_EMAIL_NOTICE_TEMPLATE, EMAIL_CATEGORIES } from './constants';

describe('confirm email notice template', () => {
  it('has the shared header, footer and sign-in placeholder', () => {
    expect(CONFIRM_EMAIL_NOTICE_TEMPLATE).toContain('mascot/navbar-logo.png');
    expect(CONFIRM_EMAIL_NOTICE_TEMPLATE).toContain(
      '2anki.net — Turn what you study into Anki flashcards'
    );
    expect(CONFIRM_EMAIL_NOTICE_TEMPLATE).toContain('{{signInUrl}}');
  });

  it('carries none of the recovery email placeholders', () => {
    expect(CONFIRM_EMAIL_NOTICE_TEMPLATE).not.toContain('{{paidEmail}}');
    expect(CONFIRM_EMAIL_NOTICE_TEMPLATE).not.toContain('{{registerUrl}}');
  });

  it('has its own delivery category', () => {
    expect(EMAIL_CATEGORIES.confirmEmailNotice).toBe('confirm-email-notice');
  });
});
