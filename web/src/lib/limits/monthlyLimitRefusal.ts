import type { TFunction } from 'i18next';
import { formatResetDate } from '../../pages/DownloadsPage/components/ConversionResult/formatResetDate';

export interface MonthlyLimitRefusal {
  cardsUsed: number;
  limit: number;
  resetOn: string;
}

export interface MonthlyLimitCopy {
  title: string;
  usage: string;
  plan: string;
}

const DIGITS = /^\d+$/;
const RESET_ON = /^\d{4}-\d{2}-\d{2}(T00:00:00(\.000)?Z)?$/;
const MAX_LIMIT = 100_000;
const MAX_USED_PER_LIMIT = 10;
const DAY_MS = 24 * 60 * 60 * 1000;
const EARLIEST_RESET_DAYS = -1;
const LATEST_RESET_DAYS = 62;

function isWholeNumberIn(
  value: unknown,
  min: number,
  max: number
): value is number {
  return (
    typeof value === 'number' &&
    Number.isSafeInteger(value) &&
    value >= min &&
    value <= max
  );
}

function countFromParam(raw: string | null): number | null {
  return raw != null && DIGITS.test(raw) ? Number(raw) : null;
}

function startOfUtcDay(date: Date): number {
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
}

function isNearTermResetDate(value: unknown, now: Date): value is string {
  if (typeof value !== 'string' || !RESET_ON.test(value)) return false;
  const reset = new Date(value);
  if (Number.isNaN(reset.getTime())) return false;
  if (reset.toISOString().slice(0, 10) !== value.slice(0, 10)) return false;
  const daysAhead = (reset.getTime() - startOfUtcDay(now)) / DAY_MS;
  return daysAhead >= EARLIEST_RESET_DAYS && daysAhead <= LATEST_RESET_DAYS;
}

function toRefusal(
  cardsUsed: unknown,
  limit: unknown,
  resetOn: unknown,
  now: Date
): MonthlyLimitRefusal | null {
  if (!isWholeNumberIn(limit, 1, MAX_LIMIT)) return null;
  if (!isWholeNumberIn(cardsUsed, 0, limit * MAX_USED_PER_LIMIT)) return null;
  if (!isNearTermResetDate(resetOn, now)) return null;
  return { cardsUsed, limit, resetOn };
}

export function monthlyLimitRefusalFromBody(
  body: unknown,
  now: Date = new Date()
): MonthlyLimitRefusal | null {
  if (body == null || typeof body !== 'object') return null;
  const { code, cards_used, limit, reset_on } = body as Record<string, unknown>;
  if (code !== 'monthly_limit') return null;
  return toRefusal(cards_used, limit, reset_on, now);
}

export function monthlyLimitRefusalFromSearch(
  params: URLSearchParams,
  now: Date = new Date()
): MonthlyLimitRefusal | null {
  if (params.get('kind') !== 'card_count') return null;
  return toRefusal(
    countFromParam(params.get('used')),
    countFromParam(params.get('limit')),
    params.get('reset_on'),
    now
  );
}

export function monthlyLimitWallPath(refusal: MonthlyLimitRefusal): string {
  const query = new URLSearchParams({
    kind: 'card_count',
    used: String(refusal.cardsUsed),
    limit: String(refusal.limit),
    reset_on: refusal.resetOn,
  });
  return `/limit?${query.toString()}`;
}

function resetDateInSentence(resetOn: string, language: string): string {
  return (formatResetDate(resetOn, language) ?? '').replace(/[.。]$/, '');
}

export function monthlyLimitCopy(
  t: TFunction,
  language: string,
  refusal: MonthlyLimitRefusal
): MonthlyLimitCopy {
  const titleKey =
    refusal.cardsUsed >= refusal.limit ? 'usedTitle' : 'overTitle';
  return {
    title: t(`errors:messages.monthlyLimit.${titleKey}`, {
      count: refusal.limit,
    }),
    usage: t('errors:messages.monthlyLimit.usage', {
      used: refusal.cardsUsed,
      limit: refusal.limit,
      date: resetDateInSentence(refusal.resetOn, language),
    }),
    plan: t('errors:messages.monthlyLimit.plan'),
  };
}
