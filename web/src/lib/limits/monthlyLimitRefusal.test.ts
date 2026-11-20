import { afterEach, describe, expect, it, vi } from 'vitest';
import i18n from '../i18n';
import {
  monthlyLimitCopy,
  monthlyLimitRefusalFromBody,
  monthlyLimitRefusalFromSearch,
  monthlyLimitWallPath,
} from './monthlyLimitRefusal';

const RESET_ON = '2026-12-01T00:00:00.000Z';

describe('monthlyLimitRefusalFromBody', () => {
  it('reads the usage from a monthly_limit response body', () => {
    expect(
      monthlyLimitRefusalFromBody({
        code: 'monthly_limit',
        reason: 'monthly_limit',
        cards_used: 100,
        limit: 100,
        reset_on: RESET_ON,
      })
    ).toEqual({ cardsUsed: 100, limit: 100, resetOn: RESET_ON });
  });

  it.each([
    ['no body', null],
    ['a different code', { code: 'one_at_a_time', cards_used: 1, limit: 100 }],
    ['an older body with no reset date', { code: 'monthly_limit' }],
    [
      'a body without the reset date',
      { code: 'monthly_limit', cards_used: 100, limit: 100 },
    ],
    [
      'a reset date that is not a date',
      { code: 'monthly_limit', cards_used: 100, limit: 100, reset_on: 'soon' },
    ],
    [
      'a count that is not a number',
      {
        code: 'monthly_limit',
        cards_used: '100',
        limit: 100,
        reset_on: RESET_ON,
      },
    ],
    [
      'a zero limit',
      { code: 'monthly_limit', cards_used: 0, limit: 0, reset_on: RESET_ON },
    ],
    [
      'a negative count',
      { code: 'monthly_limit', cards_used: -1, limit: 100, reset_on: RESET_ON },
    ],
  ])('returns null for %s', (_label, body) => {
    expect(monthlyLimitRefusalFromBody(body)).toBeNull();
  });
});

describe('monthlyLimitRefusalFromSearch', () => {
  it('reads the usage the server put on the card limit wall', () => {
    const url = new URL(
      'https://2anki.net/limit?kind=card_count&used=80&limit=100&reset_on=2026-12-01T00%3A00%3A00.000Z'
    );

    expect(monthlyLimitRefusalFromSearch(url.searchParams)).toEqual({
      cardsUsed: 80,
      limit: 100,
      resetOn: RESET_ON,
    });
  });

  it.each([
    ['/limit?kind=card_count'],
    ['/limit?kind=card_count&used=80&limit=100'],
    ['/limit?kind=card_count&used=eighty&limit=100&reset_on=2026-12-01'],
    ['/limit?kind=card_count&used=80&limit=100&reset_on=later'],
    ['/limit?kind=file_size&used=80&limit=100&reset_on=2026-12-01'],
    ['/limit?kind=anonymous&cards=40'],
  ])('returns null for %s', (path) => {
    const url = new URL(path, 'https://2anki.net');
    expect(monthlyLimitRefusalFromSearch(url.searchParams)).toBeNull();
  });

  it('round-trips the path the client builds for the wall', () => {
    const refusal = { cardsUsed: 100, limit: 100, resetOn: RESET_ON };
    const url = new URL(monthlyLimitWallPath(refusal), 'https://2anki.net');

    expect(url.pathname).toBe('/limit');
    expect(monthlyLimitRefusalFromSearch(url.searchParams)).toEqual(refusal);
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
});
