import type { SalesPeriod } from '../../types/ops/BusinessMetrics';
import {
  computeMonthlySales,
  OneTimeSale,
  oneTimeSaleFromCheckoutSession,
  saleKindFromCheckoutMetadata,
  salesWindowStartMs,
  SaleCharge,
  SaleKind,
} from './monthlySales';

const NOW = new Date('2026-11-03T10:00:00Z');
const at = (iso: string): number => new Date(iso).getTime();

const charge = (overrides: Partial<SaleCharge> = {}): SaleCharge => ({
  createdMs: at('2026-11-02T12:00:00Z'),
  amountCents: 799,
  refundedCents: 0,
  currency: 'usd',
  paymentIntentId: null,
  ...overrides,
});

const usd = (period: SalesPeriod) =>
  period.by_currency.find((row) => row.currency === 'usd');

describe('salesWindowStartMs', () => {
  it('starts at the first moment of the previous UTC month', () => {
    expect(salesWindowStartMs(NOW)).toBe(at('2026-10-01T00:00:00Z'));
  });

  it('crosses a year boundary in January', () => {
    expect(salesWindowStartMs(new Date('2027-01-15T00:00:00Z'))).toBe(
      at('2026-12-01T00:00:00Z')
    );
  });
});

describe('saleKindFromCheckoutMetadata', () => {
  it.each<[Record<string, string> | null, SaleKind]>([
    [{ pass_kind: '120d' }, 'passes'],
    [{ pass_kind: '24h', pass_anonymous: '1' }, 'passes'],
    [{ credit_pack: '1', user_id: '7' }, 'credit_packs'],
    [{ surface: 'pricing' }, 'other'],
    [null, 'other'],
  ])('classifies %j as %s', (metadata, expected) => {
    expect(saleKindFromCheckoutMetadata(metadata)).toBe(expected);
  });
});

describe('oneTimeSaleFromCheckoutSession', () => {
  const session = {
    mode: 'payment',
    metadata: { pass_kind: '24h' },
    amount_total: 600,
    currency: 'usd',
    currency_conversion: null,
  };

  it('prices a pass at its USD total', () => {
    expect(oneTimeSaleFromCheckoutSession(session)).toEqual({
      kind: 'passes',
      amountCents: 600,
      currency: 'usd',
    });
  });

  it('prices an Adaptive Pricing session in its source currency', () => {
    expect(
      oneTimeSaleFromCheckoutSession({
        ...session,
        amount_total: 560,
        currency: 'eur',
        currency_conversion: { amount_total: 600, source_currency: 'usd' },
      })
    ).toEqual({ kind: 'passes', amountCents: 600, currency: 'usd' });
  });

  it('skips subscription sessions, whose money arrives as invoices', () => {
    expect(
      oneTimeSaleFromCheckoutSession({ ...session, mode: 'subscription' })
    ).toBeNull();
  });

  it('skips a session with no total', () => {
    expect(
      oneTimeSaleFromCheckoutSession({ ...session, amount_total: null })
    ).toBeNull();
  });
});

describe('computeMonthlySales', () => {
  const kinds = new Map<string, OneTimeSale>([
    ['pi_pass', { kind: 'passes', amountCents: 2900, currency: 'usd' }],
    ['pi_day', { kind: 'passes', amountCents: 600, currency: 'usd' }],
    ['pi_credit', { kind: 'credit_packs', amountCents: 500, currency: 'usd' }],
    ['pi_other', { kind: 'other', amountCents: 100, currency: 'usd' }],
  ]);

  it('splits this month into subscriptions, passes, credit packs and other', () => {
    const sales = computeMonthlySales(
      [
        charge({ amountCents: 799 }),
        charge({ amountCents: 2900, paymentIntentId: 'pi_pass' }),
        charge({ amountCents: 500, paymentIntentId: 'pi_credit' }),
        charge({ amountCents: 100, paymentIntentId: 'pi_other' }),
        charge({ amountCents: 200, paymentIntentId: 'pi_renewal' }),
      ],
      kinds,
      NOW
    );

    expect(usd(sales.this_month)).toEqual({
      currency: 'usd',
      subscriptions_cents: 999,
      passes_cents: 2900,
      credit_packs_cents: 500,
      other_cents: 100,
      total_cents: 4499,
      charges: 5,
    });
  });

  it('nets refunds out of the month the charge was made', () => {
    const sales = computeMonthlySales(
      [
        charge({ amountCents: 600, paymentIntentId: 'pi_day' }),
        charge({
          amountCents: 2900,
          refundedCents: 2900,
          paymentIntentId: 'pi_pass',
        }),
        charge({ amountCents: 799, refundedCents: 300 }),
      ],
      kinds,
      NOW
    );

    expect(usd(sales.this_month)).toMatchObject({
      passes_cents: 600,
      subscriptions_cents: 499,
      total_cents: 1099,
      charges: 3,
    });
  });

  it('puts each charge in this month, last month, or last month to date', () => {
    const sales = computeMonthlySales(
      [
        charge({ createdMs: at('2026-11-01T00:00:00Z'), amountCents: 100 }),
        charge({ createdMs: at('2026-10-31T23:59:59Z'), amountCents: 200 }),
        charge({ createdMs: at('2026-10-03T09:59:59Z'), amountCents: 400 }),
        charge({ createdMs: at('2026-10-03T10:00:00Z'), amountCents: 800 }),
        charge({ createdMs: at('2026-09-30T23:59:59Z'), amountCents: 1600 }),
      ],
      kinds,
      NOW
    );

    expect(usd(sales.this_month)?.total_cents).toBe(100);
    expect(usd(sales.last_month)?.total_cents).toBe(1400);
    expect(usd(sales.last_month_to_date)?.total_cents).toBe(400);
    expect(sales.this_month).toMatchObject({
      start: '2026-11-01T00:00:00.000Z',
      end: '2026-11-03T10:00:00.000Z',
    });
    expect(sales.last_month).toMatchObject({
      start: '2026-10-01T00:00:00.000Z',
      end: '2026-11-01T00:00:00.000Z',
    });
    expect(sales.last_month_to_date).toMatchObject({
      start: '2026-10-01T00:00:00.000Z',
      end: '2026-10-03T10:00:00.000Z',
    });
  });

  it('keeps currencies apart, with USD first', () => {
    const sales = computeMonthlySales(
      [
        charge({ currency: 'eur', amountCents: 200 }),
        charge({ currency: 'usd', amountCents: 799 }),
        charge({ currency: 'EUR', amountCents: 200 }),
      ],
      kinds,
      NOW
    );

    expect(sales.this_month.by_currency.map((row) => row.currency)).toEqual([
      'usd',
      'eur',
    ]);
    expect(sales.this_month.by_currency[1]).toMatchObject({
      subscriptions_cents: 400,
      charges: 2,
    });
  });

  it('counts a pass bought in another currency at its USD price', () => {
    const sales = computeMonthlySales(
      [
        charge({
          currency: 'eur',
          amountCents: 560,
          paymentIntentId: 'pi_day',
        }),
        charge({
          currency: 'eur',
          amountCents: 2700,
          refundedCents: 1350,
          paymentIntentId: 'pi_pass',
        }),
      ],
      kinds,
      NOW
    );

    expect(sales.this_month.by_currency).toEqual([
      expect.objectContaining({
        currency: 'usd',
        passes_cents: 600 + 1450,
        charges: 2,
      }),
    ]);
  });

  it('caps last month to date at the end of a shorter month', () => {
    const sales = computeMonthlySales(
      [charge({ createdMs: at('2026-02-28T23:00:00Z'), amountCents: 300 })],
      kinds,
      new Date('2026-03-31T12:00:00Z')
    );

    expect(sales.last_month_to_date.end).toBe('2026-03-01T00:00:00.000Z');
    expect(usd(sales.last_month_to_date)?.total_cents).toBe(300);
  });

  it('returns empty periods when nothing sold', () => {
    const sales = computeMonthlySales([], kinds, NOW);

    expect(sales.this_month.by_currency).toEqual([]);
    expect(sales.last_month.by_currency).toEqual([]);
  });
});
