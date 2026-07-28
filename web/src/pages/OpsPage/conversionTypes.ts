export interface ConversionErrorCount {
  reason: string;
  count: number;
}

export interface FailedConversionsWeekPoint {
  week: string;
  count: number;
}

export interface DeckQualityCohort {
  engine: string;
  input_format: string;
  sample_size: number;
  no_cards_count: number;
  no_cards_rate: number | null;
  enough_data: boolean;
  composite_p10: number | null;
  composite_p50: number | null;
  composite_p90: number | null;
  card_count_p50: number | null;
  median_back_len_p50: number | null;
  blank_back_rate_p90: number | null;
}

export interface ConversionMetricsResponse {
  free_conversions_7d: number | null;
  paid_conversions_7d: number | null;
  free_conversion_success_rate_7d: number | null;
  paid_conversion_success_rate_7d: number | null;
  free_blocked_by_plan_7d: number | null;
  paid_blocked_by_plan_7d: number | null;
  conversion_errors_7d_top_reasons: ConversionErrorCount[] | null;
  failed_conversions_weekly: FailedConversionsWeekPoint[] | null;
  time_to_first_deck_median_minutes_30d: number | null;
  upload_to_download_rate_7d: number | null;
  deck_quality_cohorts_30d: DeckQualityCohort[] | null;
}
