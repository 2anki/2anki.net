import { describe, expect, it } from 'vitest';
import { cardsLeftThisMonth } from './cardsLeftThisMonth';

const usage = (used: number, unlimited = false, loading = false) => ({
  cards_used: used,
  cards_limit: 100,
  unlimited,
  loading,
});

describe('cardsLeftThisMonth', () => {
  it('counts the cards left under the monthly limit', () => {
    expect(cardsLeftThisMonth(usage(81))).toBe(19);
  });

  it('never goes below zero past the limit', () => {
    expect(cardsLeftThisMonth(usage(130))).toBe(0);
  });

  it('has no ceiling for an unlimited account', () => {
    expect(cardsLeftThisMonth(usage(500, true))).toBe(Number.POSITIVE_INFINITY);
  });

  it('is unknown while the counts load or when there are none', () => {
    expect(cardsLeftThisMonth(usage(0, false, true))).toBeNull();
    expect(cardsLeftThisMonth(null)).toBeNull();
  });
});
