import type {
  MonthlySales,
  SalesCurrencyTotal,
  SalesPeriod,
} from '../../types/ops/BusinessMetrics';

export type SaleKind = 'passes' | 'credit_packs' | 'other';

// What the Checkout session priced a one-time sale at, in the currency we set
// the price in. Adaptive Pricing charges the buyer in their own currency, so
// without this a $6 pass bought in Italy would count as euros.
export interface OneTimeSale {
  kind: SaleKind;
  amountCents: number;
  currency: string;
}

export interface SaleCharge {
  createdMs: number;
  amountCents: number;
  refundedCents: number;
  currency: string;
  paymentIntentId: string | null;
}

const monthStartUtcMs = (year: number, month: number): number =>
  Date.UTC(year, month, 1, 0, 0, 0, 0);

export const salesWindowStartMs = (now: Date): number =>
  monthStartUtcMs(now.getUTCFullYear(), now.getUTCMonth() - 1);

// Passes and credit packs are one-time Checkout payments that carry these
// metadata keys (CreatePassCheckoutUseCase, CreateCreditPackCheckoutUseCase).
// Subscription invoices never come from a payment-mode session.
export const saleKindFromCheckoutMetadata = (
  metadata: Record<string, string> | null
): SaleKind => {
  if (metadata?.pass_kind != null) return 'passes';
  if (metadata?.credit_pack != null) return 'credit_packs';
  return 'other';
};

export interface CheckoutSessionSale {
  mode: string;
  metadata: Record<string, string> | null;
  amount_total: number | null;
  currency: string | null;
  currency_conversion: {
    amount_total: number;
    source_currency: string;
  } | null;
}

export const oneTimeSaleFromCheckoutSession = (
  session: CheckoutSessionSale
): OneTimeSale | null => {
  if (session.mode !== 'payment') return null;
  const kind = saleKindFromCheckoutMetadata(session.metadata);
  if (session.currency_conversion != null) {
    return {
      kind,
      amountCents: session.currency_conversion.amount_total,
      currency: session.currency_conversion.source_currency,
    };
  }
  if (session.amount_total == null || session.currency == null) return null;
  return {
    kind,
    amountCents: session.amount_total,
    currency: session.currency,
  };
};

const emptyTotal = (currency: string): SalesCurrencyTotal => ({
  currency,
  subscriptions_cents: 0,
  passes_cents: 0,
  credit_packs_cents: 0,
  other_cents: 0,
  total_cents: 0,
  charges: 0,
});

const FIELD_BY_KIND: Record<
  SaleKind | 'subscriptions',
  keyof Omit<SalesCurrencyTotal, 'currency' | 'total_cents' | 'charges'>
> = {
  subscriptions: 'subscriptions_cents',
  passes: 'passes_cents',
  credit_packs: 'credit_packs_cents',
  other: 'other_cents',
};

const byUsdFirst = (a: SalesCurrencyTotal, b: SalesCurrencyTotal): number => {
  if (a.currency === b.currency) return 0;
  if (a.currency === 'usd') return -1;
  if (b.currency === 'usd') return 1;
  return a.currency.localeCompare(b.currency);
};

const buildPeriod = (
  startMs: number,
  endMs: number,
  charges: SaleCharge[],
  oneTimeSales: ReadonlyMap<string, OneTimeSale>
): SalesPeriod => {
  const totals = new Map<string, SalesCurrencyTotal>();
  for (const sale of charges) {
    if (sale.createdMs < startMs || sale.createdMs >= endMs) continue;
    const oneTime =
      sale.paymentIntentId == null
        ? undefined
        : oneTimeSales.get(sale.paymentIntentId);
    const kind = oneTime?.kind ?? 'subscriptions';
    const currency = (oneTime?.currency ?? sale.currency).toLowerCase();
    const total = totals.get(currency) ?? emptyTotal(currency);
    const net =
      oneTime == null
        ? sale.amountCents - sale.refundedCents
        : priceNetOfRefund(oneTime.amountCents, sale);
    total[FIELD_BY_KIND[kind]] += net;
    total.total_cents += net;
    total.charges += 1;
    totals.set(currency, total);
  }
  return {
    start: new Date(startMs).toISOString(),
    end: new Date(endMs).toISOString(),
    by_currency: [...totals.values()].sort(byUsdFirst),
  };
};

const priceNetOfRefund = (priceCents: number, sale: SaleCharge): number => {
  if (sale.refundedCents === 0 || sale.amountCents === 0) return priceCents;
  const keptShare = 1 - sale.refundedCents / sale.amountCents;
  return Math.round(priceCents * keptShare);
};

// Charges are counted in the month they were made, net of any refund, so a
// month's figure is what it sold minus what it later gave back. A charge with
// no matching payment-mode Checkout session is a subscription invoice, kept
// in the currency it was charged in.
export const computeMonthlySales = (
  charges: SaleCharge[],
  oneTimeSales: ReadonlyMap<string, OneTimeSale>,
  now: Date
): MonthlySales => {
  const nowMs = now.getTime();
  const thisMonthStart = monthStartUtcMs(
    now.getUTCFullYear(),
    now.getUTCMonth()
  );
  const lastMonthStart = salesWindowStartMs(now);
  const lastMonthToDateEnd = Math.min(
    lastMonthStart + (nowMs - thisMonthStart),
    thisMonthStart
  );

  return {
    this_month: buildPeriod(thisMonthStart, nowMs, charges, oneTimeSales),
    last_month_to_date: buildPeriod(
      lastMonthStart,
      lastMonthToDateEnd,
      charges,
      oneTimeSales
    ),
    last_month: buildPeriod(
      lastMonthStart,
      thisMonthStart,
      charges,
      oneTimeSales
    ),
  };
};
