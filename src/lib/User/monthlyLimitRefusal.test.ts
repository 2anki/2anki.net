import {
  monthlyLimitRefusalBody,
  monthlyLimitWallPath,
} from './monthlyLimitRefusal';

const RESET_ON = '2026-12-01T00:00:00.000Z';

describe('monthlyLimitWallPath', () => {
  it('puts the cards used, the limit and the reset date on the card limit wall', () => {
    const path = monthlyLimitWallPath({
      cards_used: 80,
      limit: 100,
      reset_on: RESET_ON,
    });

    const url = new URL(path, 'https://2anki.net');
    expect(url.pathname).toBe('/limit');
    expect(Object.fromEntries(url.searchParams)).toEqual({
      kind: 'card_count',
      used: '80',
      limit: '100',
      reset_on: RESET_ON,
    });
  });

  it('keeps the card limit prefix the connector matches on', () => {
    expect(
      monthlyLimitWallPath({ cards_used: 100, limit: 100, reset_on: RESET_ON })
    ).toMatch(/^\/limit\?kind=card_count&/);
  });
});

describe('monthlyLimitRefusalBody', () => {
  it('copies only the usage fields from an error-shaped source', () => {
    const source = Object.assign(new Error('Monthly card limit reached'), {
      cards_used: 100,
      limit: 100,
      candidate: 21,
      reset_on: RESET_ON,
    });

    expect(monthlyLimitRefusalBody(source)).toEqual({
      code: 'monthly_limit',
      cards_used: 100,
      limit: 100,
      reset_on: RESET_ON,
    });
  });
});
