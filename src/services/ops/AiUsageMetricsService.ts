import {
  AiUsageGroup,
  AiUsageTotals,
  IAiUsageMetricsRepository,
} from '../../data_layer/AiUsageMetricsRepository';

export interface AiUsageMetricsResponse {
  totals: AiUsageTotals;
  by_surface: AiUsageGroup[];
  by_model: AiUsageGroup[];
  by_day: AiUsageGroup[];
}

export class AiUsageMetricsService {
  constructor(private readonly deps: { repo: IAiUsageMetricsRepository }) {}

  async getMetrics(since: Date): Promise<AiUsageMetricsResponse> {
    const [totals, bySurface, byModel, byDay] = await Promise.all([
      this.deps.repo.totalsSince(since),
      this.deps.repo.totalsBySurface(since),
      this.deps.repo.totalsByModel(since),
      this.deps.repo.totalsByDay(since),
    ]);
    return {
      totals,
      by_surface: bySurface,
      by_model: byModel,
      by_day: byDay,
    };
  }
}
