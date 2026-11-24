import { vi } from 'vitest';
const send = vi.hoisted(() =>
  vi.fn().mockResolvedValue([{ statusCode: 202 }, {}])
);

vi.mock('@sendgrid/mail', () => {
  const sgMailMock = { setApiKey: vi.fn(), send };
  return { ...sgMailMock, default: sgMailMock };
});

import { EmailService } from './EmailService';
import { DEFAULT_SENDER, EMAIL_CATEGORIES } from './constants';

interface SentMessage {
  subject: string;
  html: string;
  text: string;
  categories: string[];
}

function lastMessage(): SentMessage {
  const calls = send.mock.calls;
  return calls[calls.length - 1][0] as SentMessage;
}

function serviceFor(language: string | null) {
  return new EmailService(
    'test-key',
    DEFAULT_SENDER,
    undefined,
    async () => language
  );
}

const RESUMES_AT = new Date('2026-12-01T12:00:00.000Z');

describe('pause resume warning email', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('in English', () => {
    it('offers letting the pause end or cancelling, links the account page, and never offers an extension', async () => {
      await serviceFor(null).sendSubscriptionResumingSoonEmail(
        'paused@example.com',
        RESUMES_AT,
        '$7.99'
      );

      const msg = lastMessage();
      expect(msg.subject).toBe(
        'Your 2anki subscription resumes on December 1, 2026'
      );
      expect(msg.text).toContain(
        'Your 2anki.net subscription pause ends on December 1, 2026. Billing resumes automatically at $7.99 per month from that date.'
      );
      expect(msg.text).toContain(
        'Nothing to do if you want to keep going. Your decks and settings are exactly as you left them.'
      );
      expect(msg.text).toContain(
        "To cancel instead, go to your account page before December 1, 2026. Cancelling during the pause ends your subscription right away, and you won't be charged again."
      );
      expect(msg.html).toContain('href="https://2anki.net/account"');
      expect(msg.html).not.toContain('{{');
      expect(msg.text).not.toMatch(/extend/i);
      expect(msg.categories).toEqual([
        EMAIL_CATEGORIES.subscriptionResumingSoon,
      ]);
    });

    it('names the regular price when the plan amount is unknown', async () => {
      await serviceFor(null).sendSubscriptionResumingSoonEmail(
        'paused@example.com',
        RESUMES_AT,
        null
      );

      expect(lastMessage().text).toContain(
        'Billing resumes automatically at your regular price from that date.'
      );
      expect(lastMessage().html).not.toContain('{{');
    });

    it.each(['fr', 'ja', 'pt'])(
      'sends English to a %s reader, as the other emails do',
      async (language) => {
        await serviceFor(language).sendSubscriptionResumingSoonEmail(
          'paused@example.com',
          RESUMES_AT,
          '$7.99'
        );

        expect(lastMessage().subject).toBe(
          'Your 2anki subscription resumes on December 1, 2026'
        );
      }
    );
  });

  describe('in German', () => {
    it('offers letting the pause end or cancelling, links the account page, and never offers an extension', async () => {
      await serviceFor('de').sendSubscriptionResumingSoonEmail(
        'pausiert@example.com',
        RESUMES_AT,
        '$7.99'
      );

      const msg = lastMessage();
      expect(msg.subject).toBe(
        'Dein 2anki-Abo läuft ab dem 1. Dezember 2026 weiter'
      );
      expect(msg.text).toContain(
        'Die Pause deines 2anki.net-Abos endet am 1. Dezember 2026. Ab dann werden automatisch wieder $7.99 pro Monat abgebucht.'
      );
      expect(msg.text).toContain(
        'Wenn du weitermachen willst, musst du nichts tun. Deine Stapel und Einstellungen sind genau so, wie du sie verlassen hast.'
      );
      expect(msg.text).toContain(
        'Wenn du stattdessen kündigen willst, geh vor dem 1. Dezember 2026 auf deine Kontoseite. Eine Kündigung während der Pause beendet dein Abo sofort, und dir wird nichts mehr berechnet.'
      );
      expect(msg.html).toContain('href="https://2anki.net/account"');
      expect(msg.html).not.toContain('{{');
      expect(msg.text).not.toMatch(/verlänger/i);
      expect(msg.text).not.toMatch(/Billing|cancel/);
    });

    it('names the regular price when the plan amount is unknown', async () => {
      await serviceFor('de').sendSubscriptionResumingSoonEmail(
        'pausiert@example.com',
        RESUMES_AT,
        null
      );

      expect(lastMessage().text).toContain(
        'Ab dann wird automatisch wieder dein regulärer Preis abgebucht.'
      );
    });
  });
});
