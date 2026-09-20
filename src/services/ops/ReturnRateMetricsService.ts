import { Knex } from 'knex';

export interface ReturnRateWindow {
  '7d': number | null;
  '14d': number | null;
  '30d': number | null;
}

export interface ReturnRateEligible {
  '7d': number;
  '14d': number;
  '30d': number;
}

export interface ReturnRateBySourceType {
  source_type: string;
  cohort_size: number;
  eligible_7d: number;
  eligible_14d: number;
  eligible_30d: number;
  returned_7d: number;
  returned_14d: number;
  returned_30d: number;
  return_rate_7d_pct: number | null;
  return_rate_14d_pct: number | null;
  return_rate_30d_pct: number | null;
}

export interface ReturnRateMetricsResponse {
  overall: ReturnRateWindow;
  eligible: ReturnRateEligible;
  by_source_type: ReturnRateBySourceType[] | null;
  as_of: string;
  error?: string;
}

const CONVERSION_EVENT = 'conversion_succeeded';
const MS_PER_HOUR = 60 * 60 * 1000;
const MS_PER_DAY = 24 * MS_PER_HOUR;
const MIN_RETURN_GAP_MS = 24 * MS_PER_HOUR;
const COHORT_DAYS = 90;
const PRIOR_ACTIVITY_BUFFER_DAYS = 30;
const UNKNOWN_SOURCE = 'unknown';

const WINDOWS = [
  { key: '7d', days: 7 },
  { key: '14d', days: 14 },
  { key: '30d', days: 30 },
] as const;

type WindowKey = (typeof WINDOWS)[number]['key'];

// The ops page auto-refreshes; a query that outlives the refresh interval
// stacks concurrent copies until the pool starves (#4049 — eight 4-minute
// copies observed live). Cancel server-side rather than letting them pile up.
const QUERY_TIMEOUT_MS = 30_000;

export interface NewIdentity {
  owner: string;
  source_type: string;
  first_at: string | Date;
  first_return_at: string | Date | null;
}

const pct = (num: number, denom: number): number | null => {
  if (denom === 0) return null;
  return (num / denom) * 100;
};

const emptyCounts = () => ({
  cohort: 0,
  eligible: { '7d': 0, '14d': 0, '30d': 0 } as Record<WindowKey, number>,
  returned: { '7d': 0, '14d': 0, '30d': 0 } as Record<WindowKey, number>,
});

type Counts = ReturnType<typeof emptyCounts>;

function countIdentity(counts: Counts, identity: NewIdentity, now: Date): void {
  const firstAt = new Date(identity.first_at).getTime();
  const returnGap =
    identity.first_return_at == null
      ? null
      : new Date(identity.first_return_at).getTime() - firstAt;
  const returnedAfterAWholeDay =
    returnGap != null && returnGap >= MIN_RETURN_GAP_MS;

  counts.cohort += 1;
  for (const { key, days } of WINDOWS) {
    const windowMs = days * MS_PER_DAY;
    const observedThroughWindow = now.getTime() - firstAt >= windowMs;
    if (observedThroughWindow) {
      counts.eligible[key] += 1;
      if (returnedAfterAWholeDay && returnGap <= windowMs) {
        counts.returned[key] += 1;
      }
    }
  }
}

export function computeReturnRates(
  identities: NewIdentity[],
  as_of: string
): ReturnRateMetricsResponse {
  const now = new Date(as_of);
  const total = emptyCounts();
  const bySource = new Map<string, Counts>();

  for (const identity of identities) {
    countIdentity(total, identity, now);
    const sourceCounts = bySource.get(identity.source_type) ?? emptyCounts();
    countIdentity(sourceCounts, identity, now);
    bySource.set(identity.source_type, sourceCounts);
  }

  const by_source_type: ReturnRateBySourceType[] = [];
  for (const [source_type, counts] of bySource) {
    by_source_type.push({
      source_type,
      cohort_size: counts.cohort,
      eligible_7d: counts.eligible['7d'],
      eligible_14d: counts.eligible['14d'],
      eligible_30d: counts.eligible['30d'],
      returned_7d: counts.returned['7d'],
      returned_14d: counts.returned['14d'],
      returned_30d: counts.returned['30d'],
      return_rate_7d_pct: pct(counts.returned['7d'], counts.eligible['7d']),
      return_rate_14d_pct: pct(counts.returned['14d'], counts.eligible['14d']),
      return_rate_30d_pct: pct(counts.returned['30d'], counts.eligible['30d']),
    });
  }

  by_source_type.sort((a, b) => b.cohort_size - a.cohort_size);

  return {
    overall: {
      '7d': pct(total.returned['7d'], total.eligible['7d']),
      '14d': pct(total.returned['14d'], total.eligible['14d']),
      '30d': pct(total.returned['30d'], total.eligible['30d']),
    },
    eligible: { ...total.eligible },
    by_source_type: by_source_type.length > 0 ? by_source_type : null,
    as_of,
  };
}

const NO_DATA: Omit<ReturnRateMetricsResponse, 'as_of'> = {
  overall: { '7d': null, '14d': null, '30d': null },
  eligible: { '7d': 0, '14d': 0, '30d': 0 },
  by_source_type: null,
};

export class ReturnRateMetricsService {
  constructor(private readonly database: Knex) {}

  async getMetrics(): Promise<ReturnRateMetricsResponse> {
    const now = new Date();
    const as_of = now.toISOString();

    let identities: NewIdentity[];
    try {
      identities = await this.fetchNewIdentities(now);
    } catch (err) {
      return {
        ...NO_DATA,
        as_of,
        error: err instanceof Error ? err.message : String(err),
      };
    }

    if (identities.length === 0) {
      return { ...NO_DATA, as_of };
    }

    return computeReturnRates(identities, as_of);
  }

  // The scan starts a month before the cohort so an identity that was merely
  // quiet is not mistaken for a newcomer. One pass with a window function: a
  // correlated subquery per identity is what made the old query stack up (see
  // QUERY_TIMEOUT_MS).
  buildNewIdentitiesQuery(now: Date): Knex.Raw {
    const cohortStart = new Date(now.getTime() - COHORT_DAYS * MS_PER_DAY);
    const scanStart = new Date(
      cohortStart.getTime() - PRIOR_ACTIVITY_BUFFER_DAYS * MS_PER_DAY
    );

    return this.database.raw(
      `SELECT owner, first_source AS source_type, first_at,
              MIN(created_at) FILTER (WHERE created_at >= first_at + INTERVAL '24 hours') AS first_return_at
       FROM (
         SELECT owner, created_at, id,
                MIN(created_at) OVER (PARTITION BY owner) AS first_at,
                FIRST_VALUE(source_type) OVER (PARTITION BY owner ORDER BY created_at, id) AS first_source
         FROM (
           SELECT COALESCE(user_id::text, anonymous_id) AS owner,
                  COALESCE(props->>'source', ?) AS source_type,
                  created_at, id
           FROM events
           WHERE name = ? AND created_at >= ?
             AND COALESCE(user_id::text, anonymous_id) IS NOT NULL
         ) conversions
       ) ranked
       GROUP BY owner, first_source, first_at
       HAVING first_at >= ?`,
      [UNKNOWN_SOURCE, CONVERSION_EVENT, scanStart, cohortStart]
    );
  }

  private async fetchNewIdentities(now: Date): Promise<NewIdentity[]> {
    const result = (await this.buildNewIdentitiesQuery(now).timeout(
      QUERY_TIMEOUT_MS,
      { cancel: true }
    )) as { rows: NewIdentity[] };
    return result.rows;
  }
}
