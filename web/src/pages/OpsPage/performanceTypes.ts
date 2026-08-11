export interface JobDurationPercentiles {
  window: '24h' | '7d';
  p50_ms: number | null;
  p95_ms: number | null;
  p99_ms: number | null;
  count: number;
}

export interface JobStatusBreakdown {
  status: string;
  count: number;
}

export interface SlowJob {
  id: number;
  type: string | null;
  duration_ms: number;
  card_count: number | null;
  completed_at: string;
}

export interface SignupCountryBreakdownItem {
  country: string;
  count: number;
}

export interface PerformanceMetricsResponse {
  generated_at: string;
  durations: JobDurationPercentiles[];
  status_breakdown_24h: JobStatusBreakdown[];
  slowest_jobs_24h: SlowJob[];
  signup_countries_7d: SignupCountryBreakdownItem[];
  signup_countries_7d_others?: number;
}
