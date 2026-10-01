export interface CancellationReasonCount {
  reason: string;
  count: number;
}

export interface CancellationCommentEntry {
  reason: string;
  comment: string;
  created_at: string;
}

export interface EmojiFeedbackRatingCount {
  rating: number;
  count: number;
}

export interface EmojiFeedbackCommentEntry {
  rating: number;
  comment: string;
  page: string;
  created_at: string;
}

export interface ReEngagementReasonCount {
  stopped_reason: string;
  count: number;
}

export interface ReEngagementCommentEntry {
  stopped_reason: string;
  content_type: string;
  comment: string;
  created_at: string;
}

export type HappyScoreWindowLabel = '7d' | '30d' | '90d';

export interface HappyScoreWindow {
  window: HappyScoreWindowLabel;
  love: number;
  low: number;
  n: number;
  score_pct: number | null;
  asks: number | null;
  response_rate_pct: number | null;
}
