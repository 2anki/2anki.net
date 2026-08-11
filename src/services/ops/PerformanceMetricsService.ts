import { Knex } from 'knex';
import type {
  IUserVisibleErrorsRepository,
  ErrorSurfaceCount,
} from '../../data_layer/UserVisibleErrorsRepository';

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
  signup_countries_7d_others: number;
  user_visible_errors_24h: ErrorSurfaceCount[];
  user_visible_errors_7d: ErrorSurfaceCount[];
}

// Mirrors SIGNUP_COUNTRIES_LIMIT on the Business tab: the panel shows the top
// countries and folds the tail into one "+N others" row instead of overflowing
// its card (#4050).
export const SIGNUP_COUNTRIES_PANEL_LIMIT = 10;

export function capSignupCountries(rows: SignupCountryBreakdownItem[]): {
  top: SignupCountryBreakdownItem[];
  others: number;
} {
  const top = rows.slice(0, SIGNUP_COUNTRIES_PANEL_LIMIT);
  const others = rows
    .slice(SIGNUP_COUNTRIES_PANEL_LIMIT)
    .reduce((sum, row) => sum + row.count, 0);
  return { top, others };
}

const TERMINAL_STATUSES = ['done', 'failed', 'cancelled', 'interrupted'];

const DURATION_MS_SQL =
  'EXTRACT(EPOCH FROM (last_edited_time - created_at)) * 1000';

const DONE_JOBS_SINCE_SQL = `status = 'done'
  AND last_edited_time >= NOW() - (? * INTERVAL '1 day')
  AND created_at IS NOT NULL`;

export class PerformanceMetricsService {
  constructor(
    private readonly db: Knex,
    private readonly userVisibleErrorsRepository: IUserVisibleErrorsRepository | null = null
  ) {}

  async getMetrics(): Promise<PerformanceMetricsResponse> {
    const [d24, d7, statuses, slowest, countries, errors24h, errors7d] =
      await Promise.all([
        this.getDurationPercentiles(1),
        this.getDurationPercentiles(7),
        this.getStatusBreakdown(1),
        this.getSlowestJobs(1, 20),
        this.getSignupCountries(7),
        this.getUserVisibleErrorCounts(1),
        this.getUserVisibleErrorCounts(7),
      ]);
    return {
      generated_at: new Date().toISOString(),
      durations: [
        { window: '24h', ...d24 },
        { window: '7d', ...d7 },
      ],
      status_breakdown_24h: statuses,
      slowest_jobs_24h: slowest,
      signup_countries_7d: countries.top,
      signup_countries_7d_others: countries.others,
      user_visible_errors_24h: errors24h,
      user_visible_errors_7d: errors7d,
    };
  }

  async getUserVisibleErrorCounts(
    sinceDays: number
  ): Promise<ErrorSurfaceCount[]> {
    if (this.userVisibleErrorsRepository == null) {
      return [];
    }
    return this.userVisibleErrorsRepository.countBySurfaceAndCode(sinceDays);
  }

  private async getDurationPercentiles(
    sinceDays: number
  ): Promise<Omit<JobDurationPercentiles, 'window'>> {
    const result = (await this.db.raw(
      `SELECT
         percentile_disc(0.5) WITHIN GROUP (ORDER BY ${DURATION_MS_SQL}) AS p50,
         percentile_disc(0.95) WITHIN GROUP (ORDER BY ${DURATION_MS_SQL}) AS p95,
         percentile_disc(0.99) WITHIN GROUP (ORDER BY ${DURATION_MS_SQL}) AS p99,
         COUNT(*) AS total
       FROM jobs
       WHERE ${DONE_JOBS_SINCE_SQL}
         AND last_edited_time IS NOT NULL`,
      [sinceDays]
    )) as {
      rows: {
        p50: string | null;
        p95: string | null;
        p99: string | null;
        total: string;
      }[];
    };
    const row = result.rows[0];
    return {
      p50_ms: row?.p50 == null ? null : Math.round(Number(row.p50)),
      p95_ms: row?.p95 == null ? null : Math.round(Number(row.p95)),
      p99_ms: row?.p99 == null ? null : Math.round(Number(row.p99)),
      count: row?.total == null ? 0 : Number(row.total),
    };
  }

  private async getStatusBreakdown(
    sinceDays: number
  ): Promise<JobStatusBreakdown[]> {
    const rows = (await this.db('jobs')
      .whereIn('status', TERMINAL_STATUSES)
      .where(
        'last_edited_time',
        '>=',
        this.db.raw("NOW() - (? * INTERVAL '1 day')", [sinceDays])
      )
      .select('status')
      .count<{ status: string; count: string }[]>('* as count')
      .groupBy('status')
      .orderBy('count', 'desc')) as { status: string; count: string }[];
    return rows.map((row) => ({
      status: row.status,
      count: Number(row.count),
    }));
  }

  private async getSlowestJobs(
    sinceDays: number,
    limit: number
  ): Promise<SlowJob[]> {
    const result = (await this.db.raw(
      `SELECT id, type, card_count, last_edited_time AS completed_at,
              ${DURATION_MS_SQL} AS duration_ms
       FROM jobs
       WHERE ${DONE_JOBS_SINCE_SQL}
       ORDER BY duration_ms DESC NULLS LAST
       LIMIT ?`,
      [sinceDays, limit]
    )) as {
      rows: {
        id: number;
        type: string | null;
        card_count: number | null;
        completed_at: Date | string;
        duration_ms: string;
      }[];
    };
    return result.rows.map((row) => ({
      id: Number(row.id),
      type: row.type,
      card_count: row.card_count == null ? null : Number(row.card_count),
      completed_at:
        row.completed_at instanceof Date
          ? row.completed_at.toISOString()
          : row.completed_at,
      duration_ms: Math.round(Number(row.duration_ms)),
    }));
  }

  private async getSignupCountries(sinceDays: number): Promise<{
    top: SignupCountryBreakdownItem[];
    others: number;
  }> {
    const rows = (await this.db('users')
      .whereNotNull('signup_country')
      .where(
        'created_at',
        '>=',
        this.db.raw("NOW() - (? * INTERVAL '1 day')", [sinceDays])
      )
      .select('signup_country')
      .count<{ signup_country: string; count: string }[]>('* as count')
      .groupBy('signup_country')
      .orderBy('count', 'desc')) as { signup_country: string; count: string }[];
    return capSignupCountries(
      rows.map((row) => ({
        country: row.signup_country,
        count: Number(row.count),
      }))
    );
  }
}
