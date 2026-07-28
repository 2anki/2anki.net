import { describe, expect, test } from 'vitest';

import type {
  ConversionErrorCount,
  ConversionMetricsResponse,
  FailedConversionsWeekPoint,
} from './conversionTypes';

describe('conversionTypes', () => {
  test('shapes accept the response contract returned by /api/ops/conversion/metrics', () => {
    const reason: ConversionErrorCount = { reason: 'Notion timeout', count: 3 };
    const week: FailedConversionsWeekPoint = { week: '2026-05-04', count: 1 };
    const response: ConversionMetricsResponse = {
      free_conversions_7d: 10,
      paid_conversions_7d: 2,
      free_conversion_success_rate_7d: 80,
      paid_conversion_success_rate_7d: 95,
      free_blocked_by_plan_7d: 14,
      paid_blocked_by_plan_7d: 0,
      conversion_errors_7d_top_reasons: [reason],
      failed_conversions_weekly: [week],
      time_to_first_deck_median_minutes_30d: 42.5,
      upload_to_download_rate_7d: 25,
      deck_quality_cohorts_30d: null,
    };

    expect(response.free_conversions_7d).toBe(10);
    expect(response.conversion_errors_7d_top_reasons?.[0].reason).toBe(
      'Notion timeout'
    );
    expect(response.failed_conversions_weekly?.[0].week).toBe('2026-05-04');
  });

  test('null fields are assignable for every nullable metric', () => {
    const response: ConversionMetricsResponse = {
      free_conversions_7d: null,
      paid_conversions_7d: null,
      free_conversion_success_rate_7d: null,
      paid_conversion_success_rate_7d: null,
      free_blocked_by_plan_7d: null,
      paid_blocked_by_plan_7d: null,
      conversion_errors_7d_top_reasons: null,
      failed_conversions_weekly: null,
      time_to_first_deck_median_minutes_30d: null,
      upload_to_download_rate_7d: null,
      deck_quality_cohorts_30d: null,
    };
    expect(response.free_conversions_7d).toBeNull();
    expect(response.failed_conversions_weekly).toBeNull();
  });
});
