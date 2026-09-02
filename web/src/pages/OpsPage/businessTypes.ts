export type BusinessMetricKey =
  | 'mrr_usd'
  | 'net_new_mrr_mtd_usd'
  | 'active_paying_subs'
  | 'churn_30d_pct'
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
  | 'reengagement_reasons_top'
  | 'reengagement_comments_recent'
  | 'signup_countries_90d';

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

export interface CancellationReasonPoint {
  reason: string;
  count: number;
}

export interface CancellationCommentPoint {
  reason: string;
  comment: string;
  created_at: string;
}

export interface EmojiFeedbackRatingPoint {
  rating: number;
  count: number;
}

export interface EmojiFeedbackCommentPoint {
  rating: number;
  comment: string;
  page: string;
  created_at: string;
}

export interface ReEngagementReasonPoint {
  stopped_reason: string;
  count: number;
}

export interface ReEngagementCommentPoint {
  stopped_reason: string;
  content_type: string;
  comment: string;
  created_at: string;
}

export interface SignupCountryPoint {
  country: string;
  count: number;
}

export interface BusinessMetricsResponse {
  mrr_usd: number | null;
  net_new_mrr_mtd_usd: number | null;
  active_paying_subs: number | null;
  churn_30d_pct: number | null;
  failed_payments_7d: number | null;
  new_paid_conversions_7d: number | null;
  pass_sales_7d: {
    day_passes: number;
    week_passes: number;
    semester_passes?: number;
  } | null;
  mrr_timeseries: MrrTimeseriesPoint[] | null;
  active_subs_timeseries: ActiveSubsTimeseriesPoint[] | null;
  conversions_vs_churn_weekly: ConversionsChurnWeekPoint[] | null;
  failed_payments_weekly: FailedPaymentsWeekPoint[] | null;
  cancellation_reasons_top: CancellationReasonPoint[] | null;
  cancellation_comments_recent: CancellationCommentPoint[] | null;
  emoji_feedback_ratings: EmojiFeedbackRatingPoint[] | null;
  emoji_feedback_comments: EmojiFeedbackCommentPoint[] | null;
  reengagement_reasons_top: ReEngagementReasonPoint[] | null;
  reengagement_comments_recent: ReEngagementCommentPoint[] | null;
  signup_countries_90d: SignupCountryPoint[] | null;
  as_of: string;
  cache_age_seconds: number;
  errors?: BusinessMetricError[];
}
