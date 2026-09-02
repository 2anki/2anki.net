import { GetBusinessMetricsUseCase } from './GetBusinessMetricsUseCase';
import {
  BusinessMetricsResponse,
  BusinessMetricsService,
} from '../../services/ops/BusinessMetricsService';

describe('GetBusinessMetricsUseCase', () => {
  it('delegates to the service and returns its response unchanged', async () => {
    const fake: BusinessMetricsResponse = {
      mrr_usd: 4820,
      net_new_mrr_mtd_usd: 312,
      active_paying_subs: 184,
      churn_30d_pct: 2.1,
      failed_payments_7d: 4,
      new_paid_conversions_7d: 11,
      pass_sales_7d: { day_passes: 0, week_passes: 0, semester_passes: 0 },
      mrr_timeseries: [],
      active_subs_timeseries: [],
      conversions_vs_churn_weekly: [],
      failed_payments_weekly: [],
      cancellation_reasons_top: [],
      cancellation_comments_recent: [],
      emoji_feedback_ratings: [],
      emoji_feedback_comments: [],
      reengagement_reasons_top: [],
      reengagement_comments_recent: [],
      signup_countries_90d: [],
      total_users: 19389,
      signups_24h: 31,
      signups_7d: 214,
      as_of: '2026-05-09T14:32:07.000Z',
      cache_age_seconds: 412,
    };
    const service = {
      getMetrics: jest.fn().mockResolvedValue(fake),
    } as unknown as BusinessMetricsService;
    const useCase = new GetBusinessMetricsUseCase(service);

    const result = await useCase.execute();

    expect(result).toBe(fake);
    expect(service.getMetrics as jest.Mock).toHaveBeenCalledTimes(1);
  });
});
