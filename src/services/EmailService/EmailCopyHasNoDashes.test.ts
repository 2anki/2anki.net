import { vi } from 'vitest';
import * as cheerio from 'cheerio';
import * as fs from 'fs';
import * as path from 'path';

const send = vi.hoisted(() =>
  vi.fn().mockResolvedValue([{ statusCode: 202 }, {}])
);

vi.mock('@sendgrid/mail', () => {
  const sgMailMock = { setApiKey: vi.fn(), send };
  return { ...sgMailMock, default: sgMailMock };
});

vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs')>();
  const patched = { ...actual, writeFileSync: vi.fn(), mkdirSync: vi.fn() };
  return { ...patched, default: patched };
});

import { EmailService } from './EmailService';
import { DEFAULT_SENDER } from './constants';
import { de } from './i18n/de';
import { en } from './i18n/en';

const EM_OR_EN_DASH = /[–—]/;
const DASH_TELLS = /[–—]| - /;
const FOOTER = [
  '<a href="https://2anki.net" style="color: #9ca3af; text-decoration: none;">2anki.net</a><br />',
  'Turn what you study into Anki flashcards.',
];
const TEMPLATES_DIR = path.join(__dirname, 'templates');

type SentMessage = { subject: string; text: string; html: string };

function stringsIn(value: unknown, at: string): Array<[string, string]> {
  if (typeof value === 'string') {
    return [[at, value]];
  }
  return Object.entries(value as Record<string, unknown>).flatMap(
    ([key, child]) => stringsIn(child, `${at}.${key}`)
  );
}

function visibleCopy(html: string): string {
  const $ = cheerio.load(html);
  const alts = $('[alt]')
    .map((_, el) => $(el).attr('alt'))
    .get();
  return [$('title').text(), $('body').text(), ...alts].join('\n');
}

const templateFiles = fs
  .readdirSync(TEMPLATES_DIR)
  .filter((name) => name.endsWith('.html'));

const expiresAt = new Date(Date.UTC(2026, 11, 3, 14, 30));

const sends: Array<[string, (service: EmailService) => Promise<unknown>]> = [
  ['password reset', (s) => s.sendResetEmail('a@example.com', 'tok')],
  [
    'deck ready, attached',
    (s) => s.sendConversionEmail('a@example.com', 'Deck', Buffer.from('x'), 34),
  ],
  [
    'deck ready, download link',
    (s) =>
      s.sendConversionLinkEmail(
        'a@example.com',
        'Deck',
        'https://2anki.net/d/x',
        34
      ),
  ],
  [
    'magic link, login',
    (s) => s.sendMagicLinkEmail('a@example.com', 'tok', 'login'),
  ],
  [
    'magic link, password reset',
    (s) => s.sendMagicLinkEmail('a@example.com', 'tok', 'password_reset'),
  ],
  [
    're-engagement',
    (s) => s.sendReEngagementEmail('a@example.com', 'Sam', 'tok'),
  ],
  [
    'inactivity, has a deck',
    (s) =>
      s.sendInactivityWarningEmail('a@example.com', 'tok', {
        deckName: 'Deck',
      }),
  ],
  [
    'inactivity, no deck',
    (s) => s.sendInactivityWarningEmail('a@example.com', 'tok', null),
  ],
  [
    'abandoned checkout',
    (s) => s.sendAbandonedCheckoutRecoveryEmail('a@example.com', 'tok'),
  ],
  [
    'pass ending',
    (s) => s.sendPassEndingEmail('a@example.com', 'tok', 'Week Pass'),
  ],
  [
    'semester pass ending',
    (s) => s.sendSemesterPassEndingEmail('a@example.com', 'tok', expiresAt),
  ],
  [
    'semester renewal',
    (s) => s.sendSemesterRenewalEmail('a@example.com', 'tok', expiresAt),
  ],
  [
    'subscription claim',
    (s) =>
      s.sendSubscriptionClaimConfirmation(
        'a@example.com',
        'https://2anki.net/c'
      ),
  ],
  [
    'email change confirmation',
    (s) =>
      s.sendEmailChangeConfirmationEmail(
        'b@example.com',
        'https://2anki.net/c'
      ),
  ],
  [
    'email change notification',
    (s) => s.sendEmailChangeNotificationEmail('a@example.com', 'b@example.com'),
  ],
  [
    'contact confirmation',
    (s) => s.sendContactConfirmationEmail('a@example.com'),
  ],
  [
    'pass claim',
    (s) =>
      s.sendPassClaimConfirmation(
        'a@example.com',
        'https://2anki.net/c',
        'Week Pass'
      ),
  ],
  [
    'anonymous pass claim',
    (s) =>
      s.sendAnonymousPassClaimEmail(
        'a@example.com',
        'https://2anki.net/c',
        'Week Pass'
      ),
  ],
  [
    'subscription cancelled',
    (s) =>
      s.sendSubscriptionCancelledEmail(
        'a@example.com',
        'Sam',
        `sub_dash_${crypto.randomUUID()}`
      ),
  ],
  [
    'subscription cancellation scheduled',
    (s) =>
      s.sendSubscriptionScheduledCancellationEmail(
        'a@example.com',
        'Sam',
        expiresAt
      ),
  ],
  [
    'subscription resuming, amount known',
    (s) =>
      s.sendSubscriptionResumingSoonEmail('a@example.com', expiresAt, '$7.99'),
  ],
  [
    'subscription resuming, regular price',
    (s) =>
      s.sendSubscriptionResumingSoonEmail('a@example.com', expiresAt, null),
  ],
  ['notion reconnect', (s) => s.sendNotionReconnectEmail('a@example.com')],
  [
    'price lock-in a',
    (s) => s.sendPriceLockInEmail('a@example.com', 'tok', 'a'),
  ],
  [
    'price lock-in b',
    (s) => s.sendPriceLockInEmail('a@example.com', 'tok', 'b'),
  ],
  [
    'subscription recovery',
    (s) => s.sendSubscriptionRecoveryEmail('a@example.com', 'a@example.com'),
  ],
  ['confirm email notice', (s) => s.sendConfirmEmailNotice('a@example.com')],
];

describe('email copy uses no dashes', () => {
  it.each([...stringsIn(en, 'en'), ...stringsIn(de, 'de')])(
    '%s has no em dash, en dash or spaced hyphen',
    (_key, value) => {
      expect(value).not.toMatch(DASH_TELLS);
    }
  );

  it.each(templateFiles)('%s has no dash in its copy', (name) => {
    const html = fs.readFileSync(path.join(TEMPLATES_DIR, name), 'utf8');
    expect(html).not.toMatch(EM_OR_EN_DASH);
    expect(visibleCopy(html)).not.toMatch(DASH_TELLS);
  });

  it.each(templateFiles)(
    '%s carries the shared footer: the link, then the tagline on its own line',
    (name) => {
      const lines = fs
        .readFileSync(path.join(TEMPLATES_DIR, name), 'utf8')
        .split('\n')
        .map((line) => line.trim());
      const linkAt = lines.indexOf(FOOTER[0]);
      expect(linkAt).toBeGreaterThan(-1);
      expect(lines[linkAt + 1].replace(/<br \/>$/, '')).toBe(FOOTER[1]);
    }
  );

  describe.each(['en', 'de'])('rendered in %s', (language) => {
    const service = new EmailService(
      'test-key',
      DEFAULT_SENDER,
      undefined,
      async () => language
    );

    beforeEach(() => {
      send.mockClear();
    });

    it.each(sends)(
      '%s has no dash in subject, text or html',
      async (_name, run) => {
        await run(service);
        const msg = send.mock.calls[0][0] as SentMessage;
        expect(msg.subject).not.toMatch(DASH_TELLS);
        expect(msg.text).not.toMatch(DASH_TELLS);
        expect(msg.html).not.toMatch(EM_OR_EN_DASH);
        expect(visibleCopy(msg.html)).not.toMatch(DASH_TELLS);
      }
    );
  });
});
