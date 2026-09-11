export interface TodayTarget {
  at_least?: number;
  at_most?: number;
  missedSeverity?: 'red' | 'amber';
}

export const TODAY_TARGETS = {
  signups_7d: { at_least: 250 },
  new_paid_7d: { at_least: 70 },
  pass_sales_7d: { at_least: 23 },
  churn_30d_pct: { at_most: 7 },
  conversion_success_7d_pct: { at_least: 90 },
  happy_score_90d_pct: { at_least: 60 },
  unresolved_error_groups: { at_most: 0 },
  missing_pass_unlocks_7d: { at_most: 0 },
  zero_value_paid_7d: { at_most: 0, missedSeverity: 'amber' },
} as const satisfies Record<string, TodayTarget>;

export const FAILED_PAYMENTS_SPIKE_MULTIPLIER = 2;

export const RED_MISS_RATIO = 0.25;

export const TODAY_SNAPSHOT_TTL_MS = 5 * 60 * 1000;

export const MONITOR_WINDOW_DAYS = 7;
