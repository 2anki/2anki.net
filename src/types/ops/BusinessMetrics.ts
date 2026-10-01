import type {
  CancellationCommentEntry,
  CancellationReasonCount,
  EmojiFeedbackCommentEntry,
  EmojiFeedbackRatingCount,
  HappyScoreWindow,
  ReEngagementCommentEntry,
  ReEngagementReasonCount,
} from './feedbackRows';

export interface SignupCountryCount {
  country: string;
  count: number;
}

export interface PassSalesCounts {
  day_passes: number;
  week_passes: number;
  semester_passes: number;
}

export type BusinessMetricKey =
  | 'mrr_usd'
  | 'net_new_mrr_mtd_usd'
  | 'active_paying_subs'
  | 'churn_30d_pct'
  | 'churn_30d_breakdown'
  | 'failed_payments_7d'
  | 'new_paid_conversions_7d'
  | 'mrr_timeseries'
  | 'active_subs_timeseries'
  | 'conversions_vs_churn_weekly'
  | 'failed_payments_weekly'
  | 'cancellation_reasons_top'
  | 'cancellation_comments_recent'
  | 'emoji_feedback_ratings'
  | 'emoji_feedback_comments'
  | 'happy_score'
  | 'reengagement_reasons_top'
  | 'reengagement_comments_recent'
  | 'signup_countries_90d'
  | 'total_users'
  | 'signups_24h'
  | 'signups_7d'
  | 'pass_sales_7d';

export interface BusinessMetricError {
  metric: BusinessMetricKey;
  message: string;
}

export interface MrrTimeseriesPoint {
  t: string;
  mrr_usd: number;
}

export interface ActiveSubsTimeseriesPoint {
  t: string;
  active_paying_subs: number;
}

export interface ConversionsChurnWeekPoint {
  week: string;
  new_paying: number;
  churned: number;
}

export interface FailedPaymentsWeekPoint {
  week: string;
  count: number;
}

export interface ChurnTierPoint {
  tier: string;
  churned: number;
  active: number;
}

export interface ChurnBreakdown {
  churned: number;
  ended: number;
  scheduled: number;
  voluntary: number;
  payment_failed: number;
  trailing_90d_avg_pct: number | null;
  same_period_last_year_pct: number | null;
  by_tier: ChurnTierPoint[];
}

export interface BusinessMetricsResponse {
  mrr_usd: number | null;
  net_new_mrr_mtd_usd: number | null;
  active_paying_subs: number | null;
  churn_30d_pct: number | null;
  churn_30d_breakdown: ChurnBreakdown | null;
  failed_payments_7d: number | null;
  new_paid_conversions_7d: number | null;
  pass_sales_7d: PassSalesCounts | null;
  mrr_timeseries: MrrTimeseriesPoint[] | null;
  active_subs_timeseries: ActiveSubsTimeseriesPoint[] | null;
  conversions_vs_churn_weekly: ConversionsChurnWeekPoint[] | null;
  failed_payments_weekly: FailedPaymentsWeekPoint[] | null;
  cancellation_reasons_top: CancellationReasonCount[] | null;
  cancellation_comments_recent: CancellationCommentEntry[] | null;
  emoji_feedback_ratings: EmojiFeedbackRatingCount[] | null;
  emoji_feedback_comments: EmojiFeedbackCommentEntry[] | null;
  happy_score: HappyScoreWindow[] | null;
  reengagement_reasons_top: ReEngagementReasonCount[] | null;
  reengagement_comments_recent: ReEngagementCommentEntry[] | null;
  signup_countries_90d: SignupCountryCount[] | null;
  total_users: number | null;
  signups_24h: number | null;
  signups_7d: number | null;
  as_of: string;
  cache_age_seconds: number;
  errors?: BusinessMetricError[];
}
