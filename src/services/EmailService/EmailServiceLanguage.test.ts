const send = jest.fn().mockResolvedValue([{ statusCode: 202 }, {}]);

jest.mock('@sendgrid/mail', () => ({
  setApiKey: jest.fn(),
  send,
}));

import { EmailService } from './EmailService';
import { DEFAULT_SENDER } from './constants';

const MASCOT = '2anki.net/mascot/navbar-logo.png';
const FOOTER = '2anki.net — Turn what you study into Anki flashcards';

function lastMessage() {
  const calls = send.mock.calls;
  return calls[calls.length - 1][0] as {
    to: string;
    subject: string;
    html: string;
    text: string;
  };
}

function serviceFor(language: string | null) {
  return new EmailService(
    'test-key',
    DEFAULT_SENDER,
    undefined,
    async () => language
  );
}

describe('EmailService renders copy in the recipient language', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.DOMAIN = 'https://2anki.net';
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  describe('password reset', () => {
    it('renders German copy for a de recipient', async () => {
      await serviceFor('de').sendResetEmail('de-user@example.com', 'tok-1');

      const msg = lastMessage();
      expect(msg.subject).toBe('Setze dein 2anki.net-Passwort zurück');
      expect(msg.html).toContain('Passwort zurücksetzen');
      expect(msg.html).toContain(
        'Setze dein 2anki.net-Passwort über die Schaltfläche unten zurück.'
      );
      expect(msg.html).toContain('https://2anki.net/users/r/tok-1');
      expect(msg.text).toContain(
        'Wir haben deine Anfrage zum Ändern des Passworts erhalten'
      );
      expect(msg.html).not.toContain('{{heading}}');
      expect(msg.html).not.toContain('{{link}}');
    });

    it('renders English copy for a recipient with no stored language', async () => {
      await serviceFor(null).sendResetEmail('unknown@example.com', 'tok-2');

      const msg = lastMessage();
      expect(msg.subject).toBe('Reset your 2anki.net password');
      expect(msg.html).toContain('Reset your 2anki.net password using');
      expect(msg.text).toContain('We received your password change request');
    });
  });

  describe('magic link sign-in', () => {
    it('renders German login copy for a de recipient', async () => {
      await serviceFor('de').sendMagicLinkEmail(
        'de-user@example.com',
        'tok-3',
        'login'
      );

      const msg = lastMessage();
      expect(msg.subject).toBe('Dein 2anki-Anmeldelink');
      expect(msg.html).toContain('Bei 2anki.net anmelden');
      expect(msg.html).toContain('Dieser Link läuft in 15 Minuten ab.');
      expect(msg.html).toContain('https://2anki.net/auth/magic?token=tok-3');
      expect(msg.text).toContain('Melde dich mit diesem Link');
      expect(msg.html).not.toContain('{{expiry}}');
      expect(msg.html).not.toContain('{{buttonText}}');
    });

    it('renders English login copy for an unknown recipient', async () => {
      await serviceFor(null).sendMagicLinkEmail(
        'unknown@example.com',
        'tok-4',
        'login'
      );

      const msg = lastMessage();
      expect(msg.subject).toBe('Your 2anki login link');
      expect(msg.html).toContain('Sign in to 2anki.net');
      expect(msg.html).toContain('This link expires in 15 minutes.');
    });
  });

  describe('deck ready', () => {
    it('renders German deck-ready copy for a de recipient', async () => {
      await serviceFor('de').sendConversionEmail(
        'de-user@example.com',
        'Organische Chemie',
        Buffer.from('apkg'),
        34
      );

      const msg = lastMessage();
      expect(msg.subject).toBe(
        '2anki.net – Dein Stapel «Organische Chemie» ist fertig'
      );
      expect(msg.html).toContain('Dein Stapel ist fertig');
      expect(msg.html).toContain('34 Karten');
      expect(msg.html).toContain('Organische Chemie');
      expect(msg.text).toBe(
        'Dein Stapel ist fertig: Organische Chemie — 34 Karten. Er hängt an dieser E-Mail.'
      );
      expect(msg.html).not.toContain('{{deckName}}');
      expect(msg.html).not.toContain('{{disclaimerPrefix}}');
    });

    it('renders English deck-ready copy for an unknown recipient', async () => {
      await serviceFor(null).sendConversionEmail(
        'unknown@example.com',
        'Organic Chemistry',
        Buffer.from('apkg'),
        34
      );

      const msg = lastMessage();
      expect(msg.subject).toBe(
        '2anki.net - Your «Organic Chemistry» deck is ready'
      );
      expect(msg.html).toContain('34 cards');
      expect(msg.text).toBe(
        'Your deck is ready: Organic Chemistry — 34 cards. It is attached to this email.'
      );
    });
  });

  describe('re-engagement', () => {
    it('renders German copy and keeps the unsubscribe footer for a de recipient', async () => {
      await serviceFor('de').sendReEngagementEmail(
        'de-user@example.com',
        'Lena',
        'tok-re'
      );

      const msg = lastMessage();
      expect(msg.subject).toBe('Machst du Karten noch von Hand?');
      expect(msg.html).toContain('Hallo Lena,');
      expect(msg.html).toContain('Erzähl uns, was passiert ist');
      expect(msg.html).toContain('Keine E-Mails wie diese? Abmelden');
      expect(msg.html).toContain(
        'href="https://2anki.net/unsubscribe?uid=tok-re"'
      );
      expect(msg.html).not.toContain('{{unsubscribeUrl}}');
      expect(msg.html).not.toContain('{{body}}');
      expect(msg.html).not.toContain('{{name}}');
      expect(msg.text).toContain('Hallo Lena,');
      expect(msg.text).toContain('Das 2anki-Team');
      expect(msg.text).toContain(
        'https://2anki.net/feedback/onboarding?uid=tok-re'
      );
    });

    it('renders English copy for an unknown recipient', async () => {
      await serviceFor(null).sendReEngagementEmail(
        'unknown@example.com',
        'Sam',
        'tok-re2'
      );

      const msg = lastMessage();
      expect(msg.subject).toBe('Still making cards by hand?');
      expect(msg.html).toContain('Hi Sam,');
      expect(msg.html).toContain("Don't want emails like this? Unsubscribe");
      expect(msg.html).toContain(
        'href="https://2anki.net/unsubscribe?uid=tok-re2"'
      );
    });
  });

  describe('inactivity warning', () => {
    it('renders German copy with the deck name and unsubscribe footer', async () => {
      await serviceFor('de').sendInactivityWarningEmail(
        'de-user@example.com',
        'tok-inact',
        { deckName: 'Organische Chemie' }
      );

      const msg = lastMessage();
      expect(msg.subject).toBe(
        'Deine Stapel auf 2anki — immer noch hier, wenn du sie brauchst'
      );
      expect(msg.html).toContain('Dein letzter Stapel auf 2anki war');
      expect(msg.html).toContain('Organische Chemie');
      expect(msg.html).toContain('2anki öffnen');
      expect(msg.html).toContain('Das 2anki-Team');
      expect(msg.html).toContain('Keine E-Mails wie diese? Abmelden');
      expect(msg.html).toContain(
        'href="https://2anki.net/unsubscribe?uid=tok-inact"'
      );
      expect(msg.html).not.toContain('{{bodyText}}');
      expect(msg.html).not.toContain('{{unsubscribeUrl}}');
    });

    it('renders English copy for an unknown recipient with no prior deck', async () => {
      await serviceFor(null).sendInactivityWarningEmail(
        'unknown@example.com',
        'tok-inact2'
      );

      const msg = lastMessage();
      expect(msg.subject).toBe(
        'Your decks on 2anki — still here when you need them'
      );
      expect(msg.html).toContain("You signed up for 2anki but haven't made");
      expect(msg.html).toContain("Don't want emails like this? Unsubscribe");
    });
  });

  describe('abandoned checkout recovery', () => {
    it('renders German copy and keeps the unsubscribe footer for a de recipient', async () => {
      await serviceFor('de').sendAbandonedCheckoutRecoveryEmail(
        'de-user@example.com',
        'tok-checkout'
      );

      const msg = lastMessage();
      expect(msg.subject).toBe('Schließe dein 2anki-Pro-Abo ab');
      expect(msg.html).toContain('Du hast ein 2anki-Pro-Abo begonnen');
      expect(msg.html).toContain('Anmeldung abschließen');
      expect(msg.html).toContain('Das 2anki-Team');
      expect(msg.html).toContain('Keine E-Mails wie diese? Abmelden');
      expect(msg.html).toContain(
        'href="https://2anki.net/unsubscribe?uid=tok-checkout"'
      );
      expect(msg.html).toContain(
        'https://2anki.net/checkout/resume?token=tok-checkout'
      );
      expect(msg.html).not.toContain('{{unsubscribeUrl}}');
      expect(msg.html).not.toContain('{{link}}');
    });

    it('renders English copy for an unknown recipient', async () => {
      await serviceFor(null).sendAbandonedCheckoutRecoveryEmail(
        'unknown@example.com',
        'tok-checkout2'
      );

      const msg = lastMessage();
      expect(msg.subject).toBe('Finish your 2anki Pro subscription');
      expect(msg.html).toContain('You started a 2anki Pro subscription');
      expect(msg.html).toContain("Don't want emails like this? Unsubscribe");
    });
  });

  describe('required structural blocks survive substitution', () => {
    it('keeps the mascot header, support address, and footer in German', async () => {
      await serviceFor('de').sendConversionEmail(
        'de-user@example.com',
        'Biologie',
        Buffer.from('apkg'),
        12
      );

      const msg = lastMessage();
      expect(msg.html).toContain(MASCOT);
      expect(msg.html).toContain('support@2anki.net');
      expect(msg.html).toContain(FOOTER);
    });

    it('keeps the mascot header and footer on the German reset email', async () => {
      await serviceFor('de').sendResetEmail('de-user@example.com', 'tok-5');

      const msg = lastMessage();
      expect(msg.html).toContain(MASCOT);
      expect(msg.html).toContain(FOOTER);
    });
  });

  it('defaults to English when the language lookup throws', async () => {
    const service = new EmailService(
      'test-key',
      DEFAULT_SENDER,
      undefined,
      async () => {
        throw new Error('db down');
      }
    );

    await service.sendResetEmail('user@example.com', 'tok-6');

    const msg = lastMessage();
    expect(msg.subject).toBe('Reset your 2anki.net password');
  });
});
