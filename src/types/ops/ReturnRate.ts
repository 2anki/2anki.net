export type ReturnRateWindowKey = '7d' | '14d' | '30d';

export type ReturnRateWindow = Record<ReturnRateWindowKey, number | null>;

export type ReturnRateEligible = Record<ReturnRateWindowKey, number>;

export interface ReturnRateBySourceType {
  source_type: string;
  cohort_size: number;
  eligible_7d: number;
  eligible_14d: number;
  eligible_30d: number;
  returned_7d: number;
  returned_14d: number;
  returned_30d: number;
  return_rate_7d_pct: number | null;
  return_rate_14d_pct: number | null;
  return_rate_30d_pct: number | null;
}

export interface ReturnRateMetricsResponse {
  overall: ReturnRateWindow;
  eligible: ReturnRateEligible;
  by_source_type: ReturnRateBySourceType[] | null;
  as_of: string;
  error?: string;
}
