export const AI_USAGE_WINDOWS = ['7d', '14d', '30d', '60d', '90d'] as const;

export type AiUsageWindow = (typeof AI_USAGE_WINDOWS)[number];

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

export interface AiUsageResponse {
  window: string;
  totals: AiUsageTotals;
  by_surface: AiUsageGroup[];
  by_model: AiUsageGroup[];
  by_day: AiUsageGroup[];
}
