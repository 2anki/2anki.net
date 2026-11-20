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

function isCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}

function countFromParam(raw: string | null): number | null {
  return raw != null && DIGITS.test(raw) ? Number(raw) : null;
}

function toRefusal(
  cardsUsed: unknown,
  limit: unknown,
  resetOn: unknown
): MonthlyLimitRefusal | null {
  if (!isCount(cardsUsed) || !isCount(limit) || limit === 0) return null;
  if (typeof resetOn !== 'string' || formatResetDate(resetOn) == null) {
    return null;
  }
  return { cardsUsed, limit, resetOn };
}

export function monthlyLimitRefusalFromBody(
  body: unknown
): MonthlyLimitRefusal | null {
  if (body == null || typeof body !== 'object') return null;
  const { code, cards_used, limit, reset_on } = body as Record<string, unknown>;
  if (code !== 'monthly_limit') return null;
  return toRefusal(cards_used, limit, reset_on);
}

export function monthlyLimitRefusalFromSearch(
  params: URLSearchParams
): MonthlyLimitRefusal | null {
  if (params.get('kind') !== 'card_count') return null;
  return toRefusal(
    countFromParam(params.get('used')),
    countFromParam(params.get('limit')),
    params.get('reset_on')
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
      date: formatResetDate(refusal.resetOn, language),
    }),
    plan: t('errors:messages.monthlyLimit.plan'),
  };
}
