import type { EmojiFeedbackRatingCount } from '../data_layer/EmojiFeedbackRepository';

export type HappyScoreWindowLabel = '7d' | '30d' | '90d';

export const HAPPY_SCORE_WINDOWS: ReadonlyArray<{
  label: HappyScoreWindowLabel;
  days: number;
}> = [
  { label: '7d', days: 7 },
  { label: '30d', days: 30 },
  { label: '90d', days: 90 },
];

export const MIN_HAPPY_SCORE_SAMPLE = 10;

export const HAPPY_SCORE_ASK_EVENT = 'happy_score_ask_shown';

const LOVE_RATING = 5;
const LOW_RATINGS = new Set([1, 2]);

export interface HappyScoreWindow {
  window: HappyScoreWindowLabel;
  love: number;
  low: number;
  n: number;
  score_pct: number | null;
  asks: number | null;
  response_rate_pct: number | null;
}

const roundOneDecimal = (value: number): number => Math.round(value * 10) / 10;

export function computeHappyScore(
  window: HappyScoreWindowLabel,
  counts: EmojiFeedbackRatingCount[],
  asks: number | null
): HappyScoreWindow {
  let love = 0;
  let low = 0;
  for (const entry of counts) {
    if (entry.rating === LOVE_RATING) love += entry.count;
    if (LOW_RATINGS.has(entry.rating)) low += entry.count;
  }
  const n = love + low;
  const score_pct =
    n >= MIN_HAPPY_SCORE_SAMPLE ? roundOneDecimal((love / n) * 100) : null;
  const response_rate_pct =
    asks != null && asks > 0 ? roundOneDecimal((n / asks) * 100) : null;
  return { window, love, low, n, score_pct, asks, response_rate_pct };
}
