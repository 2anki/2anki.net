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

const LATE_EVENING_UTC = new Date('2027-01-10T23:30:00.000Z');
const JUST_AFTER_MIDNIGHT_UTC = new Date('2027-01-11T00:30:00.000Z');

describe('pass end emails', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.DOMAIN = 'https://2anki.net';
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  describe('day-before email for a Week Pass holder', () => {
    it('keeps the subject and body it had, Pro first and the other passes after', async () => {
      await serviceFor(null).sendPassEndingEmail(
        'week@example.com',
        'tok-week',
        'Week Pass'
      );

      const msg = lastMessage();
      expect(msg.subject).toBe('Your Week Pass ends tomorrow');
      expect(msg.text).toContain(
        'Your Week Pass ends in about a day. Here is what happens to your account next, in two versions. Without a plan Tomorrow: the free limit is back. 100 cards a month.'
      );
      expect(msg.text).toContain(
        'With Pro Tomorrow: same login, same decks, no gap. No card limit. Next week: every conversion comes out whole. Exam week: nothing to buy. To get the second version, start Pro before your pass ends. Cancel any time. Start Pro Prefer another pass? The pricing page has Day and Week passes too. Pay once, nothing recurring.'
      );
      expect(msg.html).toContain(
        'href="https://2anki.net/r/email?t=tok-week&c=pass_ending&to=/pricing"'
      );
      expect(msg.categories).toEqual([EMAIL_CATEGORIES.passEnding]);
    });
  });

  describe('day-before email for a Semester Pass holder who can renew', () => {
    it('offers the renewal first, links the account page, and names the end in UTC', async () => {
      await serviceFor(null).sendSemesterPassEndingEmail(
        'semester@example.com',
        'tok-semester',
        LATE_EVENING_UTC
      );

      const msg = lastMessage();
      expect(msg.subject).toBe(
        'Your Semester Pass ends on 10 January 2027 at 23:30 UTC'
      );
      expect(msg.text).toContain(
        'Your Semester Pass ends on 10 January 2027 at 23:30 UTC. Here is what happens to your account next, in two versions. Without a renewal After it ends: the free limit is back. 100 cards a month.'
      );
      expect(msg.text).toContain(
        'With a renewal After it ends: the next 120 days start. Same login, same decks, no gap.'
      );
      expect(msg.text).toContain(
        'Renew before your pass ends. The button opens your account page, where you start the renewal. A renewal is a one-time payment. Nothing renews by itself. Renew Semester Pass'
      );
      expect(msg.text).toContain(
        'Prefer a plan with no end date? Pro has no card limit, and you can cancel any time. Start it from the pricing page.'
      );
      expect(msg.html).toContain(
        'href="https://2anki.net/r/email?t=tok-semester&c=pass_ending&to=/account"'
      );
      expect(msg.html).toContain(
        'href="https://2anki.net/unsubscribe?uid=tok-semester"'
      );
      expect(msg.html).not.toContain('{{');
      expect(msg.categories).toEqual([EMAIL_CATEGORIES.passEnding]);
    });

    it('offers no Day or Week pass, which a holder cannot buy before the pass ends', async () => {
      await serviceFor(null).sendSemesterPassEndingEmail(
        'semester@example.com',
        'tok-semester',
        LATE_EVENING_UTC
      );

      const msg = lastMessage();
      expect(msg.text).not.toContain('Day and Week passes');
      expect(msg.text).not.toContain('tomorrow');
      expect(msg.text.indexOf('Renew Semester Pass')).toBeLessThan(
        msg.text.indexOf('Pro has no card limit')
      );
    });

    it('renders German copy with the German end date in UTC', async () => {
      await serviceFor('de').sendSemesterPassEndingEmail(
        'semester@example.com',
        'tok-semester',
        LATE_EVENING_UTC
      );

      const msg = lastMessage();
      expect(msg.subject).toBe(
        'Dein Semester Pass endet am 10. Januar 2027 um 23:30 UTC'
      );
      expect(msg.text).toContain('Mit Verlängerung');
      expect(msg.text).toContain('Semester Pass verlängern');
      expect(msg.text).toContain(
        'Lieber ein Plan ohne Enddatum? Pro hat kein Kartenlimit und ist jederzeit kündbar.'
      );
      expect(msg.text).toContain('Das 2anki-Team');
      expect(msg.html).toContain('Keine E-Mails wie diese? Abmelden');
      expect(msg.html).not.toContain('{{');
    });
  });

  describe('week-before renewal email', () => {
    it('states the end with its time in UTC and says the next 120 days start then', async () => {
      await serviceFor(null).sendSemesterRenewalEmail(
        'semester@example.com',
        'tok-renewal',
        LATE_EVENING_UTC
      );

      const msg = lastMessage();
      expect(msg.subject).toBe(
        'Your Semester Pass ends on 10 January 2027 at 23:30 UTC'
      );
      expect(msg.text).toContain(
        'Renew it now and the next 120 days start the moment this one ends. You lose no days, and your login and decks stay as they are.'
      );
    });

    it('renders the German renewal copy with the end in UTC', async () => {
      await serviceFor('de').sendSemesterRenewalEmail(
        'semester@example.com',
        'tok-renewal',
        JUST_AFTER_MIDNIGHT_UTC
      );

      const msg = lastMessage();
      expect(msg.subject).toBe(
        'Dein Semester Pass endet am 11. Januar 2027 um 00:30 UTC'
      );
      expect(msg.text).toContain(
        'Verlängere ihn jetzt, und die nächsten 120 Tage beginnen, sobald dein aktueller Pass endet.'
      );
    });
  });

  describe.each([
    ['Europe/Berlin', 'ahead of UTC'],
    ['America/New_York', 'behind UTC'],
  ])('on a server clock in %s (%s)', (zone) => {
    let originalZone: string | undefined;

    beforeEach(() => {
      originalZone = process.env.TZ;
      process.env.TZ = zone;
    });

    afterEach(() => {
      process.env.TZ = originalZone;
    });

    it.each([
      [LATE_EVENING_UTC.toISOString(), '10 January 2027 at 23:30 UTC'],
      [JUST_AFTER_MIDNIGHT_UTC.toISOString(), '11 January 2027 at 00:30 UTC'],
    ])(
      'writes a pass ending at %s as %s in both Semester Pass emails',
      async (isoExpiry, expected) => {
        const expiresAt = new Date(isoExpiry);
        await serviceFor(null).sendSemesterRenewalEmail(
          'semester@example.com',
          'tok-renewal',
          expiresAt
        );
        expect(lastMessage().subject).toBe(
          `Your Semester Pass ends on ${expected}`
        );

        await serviceFor(null).sendSemesterPassEndingEmail(
          'semester@example.com',
          'tok-semester',
          expiresAt
        );
        expect(lastMessage().subject).toBe(
          `Your Semester Pass ends on ${expected}`
        );
      }
    );
  });
});
