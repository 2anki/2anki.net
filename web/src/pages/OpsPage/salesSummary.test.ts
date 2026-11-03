import type {
  MonthlySales,
  SalesCurrencyTotal,
  SalesPeriod,
} from '@server/types/ops/BusinessMetrics';

import { buildSalesFootnote, salesValue } from './salesSummary';

const row = (
  overrides: Partial<SalesCurrencyTotal> = {}
): SalesCurrencyTotal => ({
  currency: 'usd',
  subscriptions_cents: 0,
  passes_cents: 0,
  credit_packs_cents: 0,
  other_cents: 0,
  total_cents: 0,
  charges: 0,
  ...overrides,
});

const period = (by_currency: SalesCurrencyTotal[]): SalesPeriod => ({
  start: '2026-11-01T00:00:00.000Z',
  end: '2026-11-03T10:00:00.000Z',
  by_currency,
});

const sales = (
  thisMonth: SalesCurrencyTotal[],
  lastMonthToDate: SalesCurrencyTotal[] = [],
  lastMonth: SalesCurrencyTotal[] = []
): MonthlySales => ({
  this_month: period(thisMonth),
  last_month_to_date: period(lastMonthToDate),
  last_month: period(lastMonth),
});

describe('salesValue', () => {
  it('shows the USD total for the month so far', () => {
    expect(salesValue(sales([row({ total_cents: 123_456 })]))).toBe('$1,235');
  });

  it('shows $0 when nothing sold yet', () => {
    expect(salesValue(sales([]))).toBe('$0');
  });

  it('shows a dash when the figure could not be read', () => {
    expect(salesValue(null)).toBe('—');
  });
});

describe('buildSalesFootnote', () => {
  it('splits the month and compares it with last month', () => {
    const footnote = buildSalesFootnote(
      sales(
        [
          row({
            subscriptions_cents: 40_000,
            passes_cents: 61_200,
            total_cents: 101_200,
          }),
        ],
        [row({ total_cents: 90_000 })],
        [row({ total_cents: 410_000 })]
      )
    );

    expect(footnote).toBe(
      'subscriptions $400 · passes $612 · last month by this day $900 · all of last month $4,100'
    );
  });

  it('names credit packs and other sales only when there were some', () => {
    const footnote = buildSalesFootnote(
      sales([
        row({
          subscriptions_cents: 100,
          passes_cents: 0,
          credit_packs_cents: 500,
          other_cents: 300,
          total_cents: 900,
        }),
      ])
    );

    expect(footnote).toBe(
      'subscriptions $1 · passes $0 · credit packs $5 · other $3 · last month by this day $0 · all of last month $0'
    );
  });

  it('adds sales in other currencies, which are not in the USD total', () => {
    const footnote = buildSalesFootnote(
      sales([
        row({ subscriptions_cents: 799, total_cents: 799 }),
        row({
          currency: 'eur',
          subscriptions_cents: 1_400,
          total_cents: 1_400,
        }),
      ])
    );

    expect(footnote).toContain('plus €14 in EUR, not in the total');
  });

  it('is empty when the figure could not be read', () => {
    expect(buildSalesFootnote(null)).toBeUndefined();
  });
});
