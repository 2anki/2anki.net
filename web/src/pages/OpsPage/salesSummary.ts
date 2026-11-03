import type {
  MonthlySales,
  SalesCurrencyTotal,
  SalesPeriod,
} from '@server/types/ops/BusinessMetrics';

import { formatUsd } from './businessHelpers';

const usdRow = (period: SalesPeriod): SalesCurrencyTotal | undefined =>
  period.by_currency.find((row) => row.currency === 'usd');

const usdCents = (
  period: SalesPeriod,
  field: keyof SalesCurrencyTotal
): number => {
  const value = usdRow(period)?.[field];
  return typeof value === 'number' ? value : 0;
};

const dollars = (cents: number): string => formatUsd(cents / 100);

const formatInCurrency = (cents: number, currency: string): string =>
  new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: currency.toUpperCase(),
    maximumFractionDigits: 0,
  }).format(cents / 100);

export const salesValue = (sales: MonthlySales | null): string =>
  sales == null ? '—' : dollars(usdCents(sales.this_month, 'total_cents'));

export const buildSalesFootnote = (
  sales: MonthlySales | null
): string | undefined => {
  if (sales == null) return undefined;
  const month = sales.this_month;
  const parts = [
    `subscriptions ${dollars(usdCents(month, 'subscriptions_cents'))}`,
    `passes ${dollars(usdCents(month, 'passes_cents'))}`,
  ];
  const creditPacks = usdCents(month, 'credit_packs_cents');
  if (creditPacks !== 0) parts.push(`credit packs ${dollars(creditPacks)}`);
  const other = usdCents(month, 'other_cents');
  if (other !== 0) parts.push(`other ${dollars(other)}`);
  parts.push(
    `last month by this day ${dollars(usdCents(sales.last_month_to_date, 'total_cents'))}`,
    `all of last month ${dollars(usdCents(sales.last_month, 'total_cents'))}`
  );
  const foreign = month.by_currency.filter((row) => row.currency !== 'usd');
  if (foreign.length > 0) {
    const amounts = foreign
      .map(
        (row) =>
          `${formatInCurrency(row.total_cents, row.currency)} in ${row.currency.toUpperCase()}`
      )
      .join(', ');
    parts.push(`plus ${amounts}, not in the total`);
  }
  return parts.join(' · ');
};
