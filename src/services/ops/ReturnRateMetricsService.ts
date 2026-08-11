import { Knex } from 'knex';

export interface ReturnRateWindow {
  '7d': number | null;
  '14d': number | null;
  '30d': number | null;
}

export interface ReturnRateBySourceType {
  source_type: string;
  cohort_size: number;
  returned_7d: number;
  returned_14d: number;
  returned_30d: number;
  return_rate_7d_pct: number | null;
  return_rate_14d_pct: number | null;
  return_rate_30d_pct: number | null;
}

export interface ReturnRateMetricsResponse {
  overall: ReturnRateWindow;
  by_source_type: ReturnRateBySourceType[] | null;
  as_of: string;
  error?: string;
}

const CONVERSION_EVENT = 'conversion_succeeded';
const SECONDS_PER_DAY = 24 * 60 * 60;
const LOOKBACK_DAYS = 90;
const UNKNOWN_SOURCE = 'unknown';

// The ops page auto-refreshes; a query that outlives the refresh interval
// stacks concurrent copies until the pool starves (#4049 — eight 4-minute
// copies observed live). Cancel server-side rather than letting them pile up.
const QUERY_TIMEOUT_MS = 30_000;

export interface CohortMember {
  owner: string;
  source_type: string;
  last_success_at: string;
}

export interface ReturnRecord {
  owner: string;
  source_type: string;
  anchor_at: string;
  first_return_at: string;
}

const pct = (num: number, denom: number): number | null => {
  if (denom === 0) return null;
  return (num / denom) * 100;
};

export function computeReturnRates(
  cohort: CohortMember[],
  returns: ReturnRecord[],
  as_of: string
): ReturnRateMetricsResponse {
  const returnMap = new Map<string, { gapMs: number }>();
  for (const r of returns) {
    const key = `${r.owner}::${r.source_type}`;
    const gapMs =
      new Date(r.first_return_at).getTime() - new Date(r.anchor_at).getTime();
    const existing = returnMap.get(key);
    if (existing == null || gapMs < existing.gapMs) {
      returnMap.set(key, { gapMs });
    }
  }

  const sourceMap = new Map<
    string,
    { cohort: number; r7: number; r14: number; r30: number }
  >();

  let totalCohort = 0;
  let totalR7 = 0;
  let totalR14 = 0;
  let totalR30 = 0;

  for (const member of cohort) {
    const key = `${member.owner}::${member.source_type}`;
    const ret = returnMap.get(key);
    const gapMs = ret?.gapMs ?? Infinity;

    const returned7 = gapMs <= 7 * SECONDS_PER_DAY * 1000 ? 1 : 0;
    const returned14 = gapMs <= 14 * SECONDS_PER_DAY * 1000 ? 1 : 0;
    const returned30 = gapMs <= 30 * SECONDS_PER_DAY * 1000 ? 1 : 0;

    totalCohort += 1;
    totalR7 += returned7;
    totalR14 += returned14;
    totalR30 += returned30;

    const existing = sourceMap.get(member.source_type) ?? {
      cohort: 0,
      r7: 0,
      r14: 0,
      r30: 0,
    };
    existing.cohort += 1;
    existing.r7 += returned7;
    existing.r14 += returned14;
    existing.r30 += returned30;
    sourceMap.set(member.source_type, existing);
  }

  const by_source_type: ReturnRateBySourceType[] = [];
  for (const [source_type, counts] of sourceMap) {
    by_source_type.push({
      source_type,
      cohort_size: counts.cohort,
      returned_7d: counts.r7,
      returned_14d: counts.r14,
      returned_30d: counts.r30,
      return_rate_7d_pct: pct(counts.r7, counts.cohort),
      return_rate_14d_pct: pct(counts.r14, counts.cohort),
      return_rate_30d_pct: pct(counts.r30, counts.cohort),
    });
  }

  return {
    overall: {
      '7d': pct(totalR7, totalCohort),
      '14d': pct(totalR14, totalCohort),
      '30d': pct(totalR30, totalCohort),
    },
    by_source_type: by_source_type.length > 0 ? by_source_type : null,
    as_of,
  };
}

export class ReturnRateMetricsService {
  constructor(private readonly database: Knex) {}

  async getMetrics(): Promise<ReturnRateMetricsResponse> {
    const now = new Date();
    const as_of = now.toISOString();

    let cohort: CohortMember[];
    let returns: ReturnRecord[];

    try {
      [cohort, returns] = await Promise.all([
        this.fetchCohort(now),
        this.fetchReturns(now),
      ]);
    } catch (err) {
      return {
        overall: { '7d': null, '14d': null, '30d': null },
        by_source_type: null,
        as_of,
        error: err instanceof Error ? err.message : String(err),
      };
    }

    if (cohort.length === 0) {
      return {
        overall: { '7d': null, '14d': null, '30d': null },
        by_source_type: null,
        as_of,
      };
    }

    return computeReturnRates(cohort, returns, as_of);
  }

  private cutoff(now: Date): Date {
    return new Date(now.getTime() - LOOKBACK_DAYS * SECONDS_PER_DAY * 1000);
  }

  buildCohortQuery(now: Date): Knex.QueryBuilder {
    return this.database('events')
      .where('name', CONVERSION_EVENT)
      .where('created_at', '>=', this.cutoff(now))
      .whereRaw('COALESCE(user_id::text, anonymous_id) IS NOT NULL')
      .select(
        this.database.raw('COALESCE(user_id::text, anonymous_id) as owner'),
        this.database.raw("COALESCE(props->>'source', ?) as source_type", [
          UNKNOWN_SOURCE,
        ]),
        this.database.raw('MAX(created_at) as last_success_at')
      )
      .groupByRaw(
        "COALESCE(user_id::text, anonymous_id), COALESCE(props->>'source', ?)",
        [UNKNOWN_SOURCE]
      );
  }

  buildReturnsQuery(now: Date): Knex.QueryBuilder {
    return this.database('events as e1')
      .where('e1.name', CONVERSION_EVENT)
      .where('e1.created_at', '>=', this.cutoff(now))
      .whereRaw('COALESCE(e1.user_id::text, e1.anonymous_id) IS NOT NULL')
      .select(
        this.database.raw(
          'COALESCE(e1.user_id::text, e1.anonymous_id) as owner'
        ),
        this.database.raw("COALESCE(e1.props->>'source', ?) as source_type", [
          UNKNOWN_SOURCE,
        ]),
        'e1.created_at as anchor_at',
        this.database.raw(
          'LEAD(e1.created_at) OVER (' +
            'PARTITION BY COALESCE(e1.user_id::text, e1.anonymous_id), ' +
            "COALESCE(e1.props->>'source', ?) " +
            'ORDER BY e1.created_at) as first_return_at',
          [UNKNOWN_SOURCE]
        )
      );
  }

  private fetchCohort(now: Date): Promise<CohortMember[]> {
    return this.buildCohortQuery(now).timeout(QUERY_TIMEOUT_MS, {
      cancel: true,
    }) as Promise<CohortMember[]>;
  }

  private async fetchReturns(now: Date): Promise<ReturnRecord[]> {
    const rows = (await this.buildReturnsQuery(now).timeout(QUERY_TIMEOUT_MS, {
      cancel: true,
    })) as Array<{
      owner: string;
      source_type: string;
      anchor_at: string;
      first_return_at: string | null;
    }>;

    const seen = new Set<string>();
    const result: ReturnRecord[] = [];

    for (let i = rows.length - 1; i >= 0; i--) {
      const row = rows[i];
      if (row.first_return_at == null) continue;
      const key = `${row.owner}::${row.source_type}`;
      if (seen.has(key)) continue;
      seen.add(key);
      result.push({
        owner: row.owner,
        source_type: row.source_type,
        anchor_at: row.anchor_at,
        first_return_at: row.first_return_at,
      });
    }

    return result;
  }
}
