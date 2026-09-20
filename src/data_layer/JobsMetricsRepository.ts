import type { Knex } from 'knex';

import type {
  ConversionErrorCount,
  FailedConversionsWeekPoint,
} from '../services/ops/ConversionMetricsService';
import { normalizeFailureReasons } from './normalizeFailureReasons';

export interface IJobsMetricsRepository {
  topFailureReasons7d(sevenDaysAgo: Date): Promise<ConversionErrorCount[]>;
  failedConversionsWeekly(
    earliestStart: Date,
    weekEnd: Date
  ): Promise<Array<{ weekStart: Date; count: number }>>;
}

const NOTION_CONVERSION_TYPES: string[] = ['page', 'database', 'conversion'];

export class JobsMetricsRepository implements IJobsMetricsRepository {
  constructor(private readonly database: Knex) {}

  async topFailureReasons7d(
    sevenDaysAgo: Date
  ): Promise<ConversionErrorCount[]> {
    const results = await this.database('jobs')
      .where('jobs.status', 'failed')
      .where('jobs.created_at', '>=', sevenDaysAgo)
      .whereIn('jobs.type', NOTION_CONVERSION_TYPES)
      .whereNotNull('jobs.job_reason_failure')
      .select('jobs.job_reason_failure as reason')
      .count('jobs.id as count')
      .groupBy('jobs.job_reason_failure');

    const rawRows = (
      results as Array<{ reason: string; count: number | string }>
    ).map((row) => ({
      reason: row.reason || 'Unknown',
      count: Number(row.count),
    }));

    return normalizeFailureReasons(rawRows);
  }

  async failedConversionsWeekly(
    earliestStart: Date,
    weekEnd: Date
  ): Promise<Array<{ weekStart: Date; count: number }>> {
    const results = await this.database('jobs')
      .where('jobs.status', 'failed')
      .where('jobs.created_at', '>=', earliestStart)
      .where('jobs.created_at', '<', weekEnd)
      .whereIn('jobs.type', NOTION_CONVERSION_TYPES)
      .select(
        this.database.raw(`DATE_TRUNC('week', jobs.created_at) AS week_start`),
        this.database.raw('COUNT(*) as count')
      )
      .groupBy('week_start')
      .orderBy('week_start', 'asc');

    return (
      results as Array<{ week_start: Date | string; count: number | string }>
    ).map((row) => ({
      weekStart: new Date(row.week_start),
      count: Number(row.count),
    }));
  }
}

export type { ConversionErrorCount, FailedConversionsWeekPoint };
