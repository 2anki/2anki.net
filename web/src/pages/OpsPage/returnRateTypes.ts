export interface ReturnRateWindow {
  '7d': number | null;
  '14d': number | null;
  '30d': number | null;
}

export interface ReturnRateBySourceType {
  source_type: string;
  cohort_size: number;
  returned_7d: number;
  returned_14d: number;
  returned_30d: number;
  return_rate_7d_pct: number | null;
  return_rate_14d_pct: number | null;
  return_rate_30d_pct: number | null;
}

export interface ReturnRateMetricsResponse {
  overall: ReturnRateWindow;
  by_source_type: ReturnRateBySourceType[] | null;
  as_of: string;
  error?: string;
}
