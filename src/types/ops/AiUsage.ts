export interface AiUsageTotals {
  calls: number;
  cost_usd: number;
  input_tokens: number;
  output_tokens: number;
  cache_creation_tokens: number;
  cache_read_tokens: number;
}

export interface AiUsageGroup extends AiUsageTotals {
  key: string;
}

export interface AiUsageMetricsResponse {
  totals: AiUsageTotals;
  by_surface: AiUsageGroup[];
  by_model: AiUsageGroup[];
  by_day: AiUsageGroup[];
  by_user: AiUsageGroup[];
}

export interface AiUsageMetricsPayload extends AiUsageMetricsResponse {
  window: string;
}
