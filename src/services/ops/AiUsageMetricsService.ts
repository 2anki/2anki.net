import { IAiUsageMetricsRepository } from '../../data_layer/AiUsageMetricsRepository';
import type { AiUsageMetricsResponse } from '../../types/ops/AiUsage';

export type { AiUsageMetricsResponse };

export class AiUsageMetricsService {
  constructor(private readonly deps: { repo: IAiUsageMetricsRepository }) {}

  async getMetrics(since: Date): Promise<AiUsageMetricsResponse> {
    const [totals, bySurface, byModel, byDay, byUser] = await Promise.all([
      this.deps.repo.totalsSince(since),
      this.deps.repo.totalsBySurface(since),
      this.deps.repo.totalsByModel(since),
      this.deps.repo.totalsByDay(since),
      this.deps.repo.totalsByUser(since),
    ]);
    return {
      totals,
      by_surface: bySurface,
      by_model: byModel,
      by_day: byDay,
      by_user: byUser,
    };
  }
}
