import { afterEach, describe, expect, it, vi } from 'vitest';
import i18n from '../i18n';
import {
  monthlyLimitCopy,
  monthlyLimitRefusalFromBody,
  monthlyLimitRefusalFromSearch,
  monthlyLimitWallPath,
} from './monthlyLimitRefusal';

const NOW = new Date('2026-11-20T09:00:00.000Z');
const RESET_ON = '2026-12-01T00:00:00.000Z';
const LANGS = ['en', 'de', 'es', 'fr', 'it', 'ja', 'nl', 'pl', 'pt', 'ru'];

function searchOf(query: string): URLSearchParams {
  return new URL(`https://2anki.net/limit?${query}`).searchParams;
}

function bodyWith(fields: Record<string, unknown>): Record<string, unknown> {
  return {
    code: 'monthly_limit',
    cards_used: 100,
    limit: 100,
    reset_on: RESET_ON,
    ...fields,
  };
}

const ACCEPTED_RESET_DATES = [
  ['the server wire format', '2026-12-01T00:00:00.000Z'],
  ['a midnight timestamp without milliseconds', '2026-12-01T00:00:00Z'],
  ['a plain date', '2026-12-01'],
  ['yesterday', '2026-11-19'],
  ['62 days ahead', '2027-01-21'],
];

const REJECTED_RESET_DATES = [
  ['a day that does not exist', '2026-02-30'],
  ['a bare 1', '1'],
  ['a bare 0', '0'],
  ['a bare 99999', '99999'],
  ['an extended negative year', '-000001-01-01'],
  ['a written date', 'Dec 25 2026'],
  ['a timestamp with an offset', '2026-12-01T00:00:00+14:00'],
  ['a timestamp that is not midnight', '2026-12-01T09:30:00.000Z'],
  ['a date years in the past', '2020-12-01'],
  ['a date years ahead', '2031-12-01'],
  ['two days ago', '2026-11-18'],
  ['63 days ahead', '2027-01-22'],
  ['a word', 'soon'],
];

describe('monthlyLimitRefusalFromBody', () => {
  it('reads the usage from a monthly_limit response body', () => {
    expect(
      monthlyLimitRefusalFromBody(
        bodyWith({ reason: 'monthly_limit', cards_used: 80 }),
        NOW
      )
    ).toEqual({ cardsUsed: 80, limit: 100, resetOn: RESET_ON });
  });

  it.each(ACCEPTED_RESET_DATES)('accepts %s', (_label, resetOn) => {
    expect(
      monthlyLimitRefusalFromBody(bodyWith({ reset_on: resetOn }), NOW)
    ).toEqual({ cardsUsed: 100, limit: 100, resetOn });
  });

  it.each([
    ['no body', null],
    ['a different code', { code: 'one_at_a_time', cards_used: 1, limit: 100 }],
    ['an older body with no usage', { code: 'monthly_limit' }],
    ['a body without the reset date', bodyWith({ reset_on: undefined })],
    ['a count sent as a string', bodyWith({ cards_used: '100' })],
    ['a zero limit', bodyWith({ cards_used: 0, limit: 0 })],
    ['a limit over 100000', bodyWith({ limit: 999999999 })],
    ['a negative count', bodyWith({ cards_used: -1 })],
    ['a fractional count', bodyWith({ cards_used: 80.5 })],
    ['a count past the safe integers', bodyWith({ cards_used: 1e23 })],
    ['a count over ten times the limit', bodyWith({ cards_used: 1001 })],
    ['a reset date that is not a string', bodyWith({ reset_on: 20261201 })],
    ...REJECTED_RESET_DATES.map(
      ([label, resetOn]) =>
        [`a reset date that is ${label}`, bodyWith({ reset_on: resetOn })] as [
          string,
          unknown,
        ]
    ),
  ])('returns null for %s', (_label, body) => {
    expect(monthlyLimitRefusalFromBody(body, NOW)).toBeNull();
  });

  it('reads the clock when none is passed', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2030-01-15T12:00:00.000Z'));
    try {
      expect(monthlyLimitRefusalFromBody(bodyWith({}))).toBeNull();
      expect(
        monthlyLimitRefusalFromBody(bodyWith({ reset_on: '2030-02-01' }))
      ).toEqual({ cardsUsed: 100, limit: 100, resetOn: '2030-02-01' });
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('monthlyLimitRefusalFromSearch', () => {
  it('reads the usage the server put on the card limit wall', () => {
    expect(
      monthlyLimitRefusalFromSearch(
        searchOf(
          'kind=card_count&used=80&limit=100&reset_on=2026-12-01T00%3A00%3A00.000Z'
        ),
        NOW
      )
    ).toEqual({ cardsUsed: 80, limit: 100, resetOn: RESET_ON });
  });

  it.each([
    ['no usage', 'kind=card_count'],
    ['a word for the count', 'kind=card_count&used=eighty&limit=100'],
    [
      'a count past the safe integers',
      'kind=card_count&used=99999999999999999999999&limit=100',
    ],
    ['a limit over 100000', 'kind=card_count&used=80&limit=999999999'],
    ['a zero limit', 'kind=card_count&used=0&limit=0'],
    ['a count over ten times the limit', 'kind=card_count&used=1001&limit=100'],
    ['exponent notation', 'kind=card_count&used=1e2&limit=100'],
    ['a sign', 'kind=card_count&used=%2B80&limit=100'],
    ['a minus sign', 'kind=card_count&used=-80&limit=100'],
    ['a decimal', 'kind=card_count&used=80.0&limit=100'],
    ['whitespace', 'kind=card_count&used=%2080&limit=100'],
    ['full-width digits', 'kind=card_count&used=%EF%BC%98%EF%BC%90&limit=100'],
    ['another wall kind', 'kind=file_size&used=80&limit=100'],
    ['the anonymous wall', 'kind=anonymous&cards=40'],
  ])('returns null for %s', (_label, query) => {
    const params = searchOf(`${query}&reset_on=2026-12-01`);
    expect(monthlyLimitRefusalFromSearch(params, NOW)).toBeNull();
  });

  it('returns null for a query with no reset date', () => {
    expect(
      monthlyLimitRefusalFromSearch(
        searchOf('kind=card_count&used=80&limit=100'),
        NOW
      )
    ).toBeNull();
  });

  it.each(REJECTED_RESET_DATES)(
    'returns null for a reset date that is %s',
    (_label, resetOn) => {
      const params = searchOf(
        `kind=card_count&used=80&limit=100&reset_on=${encodeURIComponent(resetOn)}`
      );
      expect(monthlyLimitRefusalFromSearch(params, NOW)).toBeNull();
    }
  );

  it('round-trips the path the client builds for the wall', () => {
    const refusal = { cardsUsed: 100, limit: 100, resetOn: RESET_ON };
    const url = new URL(monthlyLimitWallPath(refusal), 'https://2anki.net');

    expect(url.pathname).toBe('/limit');
    expect(monthlyLimitRefusalFromSearch(url.searchParams, NOW)).toEqual(
      refusal
    );
  });
});

describe('monthlyLimitCopy', () => {
  afterEach(async () => {
    await i18n.changeLanguage('en');
  });

  it('says the cards are used up, how many were made, and the reset date', () => {
    const copy = monthlyLimitCopy(i18n.t, 'en', {
      cardsUsed: 100,
      limit: 100,
      resetOn: RESET_ON,
    });

    expect(copy).toEqual({
      title: "You've used your 100 free cards this month.",
      usage: "You've made 100 of 100. The limit resets on 1 December 2026.",
      plan: 'A plan lets you convert more now.',
    });
  });

  it('says the deck would go past the limit when cards are left', () => {
    const copy = monthlyLimitCopy(i18n.t, 'en', {
      cardsUsed: 80,
      limit: 100,
      resetOn: RESET_ON,
    });

    expect(copy.title).toBe(
      'This deck would go past your 100 free cards this month.'
    );
    expect(copy.usage).toBe(
      "You've made 80 of 100. The limit resets on 1 December 2026."
    );
  });

  it("shows the server's reset date whatever the viewer's clock and zone say", () => {
    const originalZone = process.env.TZ;
    process.env.TZ = 'America/Los_Angeles';
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-12-01T03:00:00.000Z'));
    try {
      const copy = monthlyLimitCopy(i18n.t, 'en', {
        cardsUsed: 100,
        limit: 100,
        resetOn: RESET_ON,
      });

      expect(copy.usage).toBe(
        "You've made 100 of 100. The limit resets on 1 December 2026."
      );
    } finally {
      vi.useRealTimers();
      process.env.TZ = originalZone;
    }
  });

  it('uses the singular card for a limit of one', () => {
    const copy = monthlyLimitCopy(i18n.t, 'en', {
      cardsUsed: 1,
      limit: 1,
      resetOn: RESET_ON,
    });

    expect(copy.title).toBe("You've used your 1 free card this month.");
  });

  it('writes the copy and the date in German for a German reader', async () => {
    await i18n.changeLanguage('de');

    const copy = monthlyLimitCopy(i18n.t, 'de', {
      cardsUsed: 100,
      limit: 100,
      resetOn: RESET_ON,
    });

    expect(copy).toEqual({
      title: 'Du hast diesen Monat deine 100 kostenlosen Karten genutzt.',
      usage:
        'Du hast 100 von 100 erstellt. Das Limit wird am 1. Dezember 2026 zurückgesetzt.',
      plan: 'Mit einem Tarif kannst du jetzt mehr konvertieren.',
    });
  });

  it('ends the Russian usage sentence with one period after the year mark', async () => {
    await i18n.changeLanguage('ru');

    const copy = monthlyLimitCopy(i18n.t, 'ru', {
      cardsUsed: 100,
      limit: 100,
      resetOn: RESET_ON,
    });

    expect(copy.usage).toBe(
      'Использовано 100 из 100. Лимит обновится 1 декабря 2026 г.'
    );
  });

  it.each([
    [1, 'Лимит в 1 бесплатную карту на этот месяц исчерпан.'],
    [3, 'Лимит в 3 бесплатные карты на этот месяц исчерпан.'],
    [100, 'Лимит в 100 бесплатных карт на этот месяц исчерпан.'],
  ])(
    'picks the Russian plural form for a limit of %i',
    async (limit, title) => {
      await i18n.changeLanguage('ru');

      const copy = monthlyLimitCopy(i18n.t, 'ru', {
        cardsUsed: limit,
        limit,
        resetOn: RESET_ON,
      });

      expect(copy.title).toBe(title);
    }
  );

  it.each(LANGS)(
    'writes a %s usage sentence with the numbers, the date and one closing mark',
    async (lang) => {
      await i18n.changeLanguage(lang);

      const copy = monthlyLimitCopy(i18n.t, lang, {
        cardsUsed: 80,
        limit: 100,
        resetOn: RESET_ON,
      });

      expect(copy.usage).toContain('80');
      expect(copy.usage).toContain('2026');
      expect(copy.usage).not.toMatch(/\.\.|。。|\.。|。\./);
      expect(`${copy.title} ${copy.usage} ${copy.plan}`).not.toMatch(
        /undefined|NaN|Invalid Date|\de[+-]?\d|{{/
      );
    }
  );
});
