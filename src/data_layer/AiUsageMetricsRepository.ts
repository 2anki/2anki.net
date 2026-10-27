import type { Knex } from 'knex';

import { withServerMarker } from '../lib/events/serverEventProps';
import type { AiUsageGroup, AiUsageTotals } from '../types/ops/AiUsage';

export type { AiUsageGroup, AiUsageTotals };

const AI_USAGE_EVENT = 'ai_usage_recorded';

// Per-user dedup counts trust marked rows once any fall inside the window.
// Until then, rows written before the marker shipped still count, so a deploy
// does not re-send every recent spend alert.
const SERVER_MARKER_JSON = JSON.stringify(withServerMarker({}));

export interface AiUsageTotalsRow {
  calls: number | string;
  cost_usd: number | string;
  input_tokens: number | string;
  output_tokens: number | string;
  cache_creation_tokens: number | string;
  cache_read_tokens: number | string;
}

export interface AiUsageGroupRow extends AiUsageTotalsRow {
  key: string | null;
}

export interface IAiUsageMetricsRepository {
  totalsSince(since: Date): Promise<AiUsageTotals>;
  totalsBySurface(since: Date): Promise<AiUsageGroup[]>;
  totalsByModel(since: Date): Promise<AiUsageGroup[]>;
  totalsByDay(since: Date): Promise<AiUsageGroup[]>;
  totalsByUser(since: Date): Promise<AiUsageGroup[]>;
}

export interface IAiSpendReader {
  userCostSince(userId: number, since: Date): Promise<number>;
  eventCountSince(name: string, userId: number, since: Date): Promise<number>;
}

export interface IAnonymousPassSpendReader {
  anonymousPassCostSince(anonymousPassId: number, since: Date): Promise<number>;
  anonymousPassEventCountSince(
    name: string,
    anonymousPassId: number,
    since: Date
  ): Promise<number>;
}

export interface IAiRequestCostReader {
  costByRequestId(
    userId: number,
    requestId: string,
    since: Date
  ): Promise<number>;
}

export function mapAiUsageTotalsRow(
  row: AiUsageTotalsRow | undefined
): AiUsageTotals {
  return {
    calls: Number(row?.calls ?? 0),
    cost_usd: Number(row?.cost_usd ?? 0),
    input_tokens: Number(row?.input_tokens ?? 0),
    output_tokens: Number(row?.output_tokens ?? 0),
    cache_creation_tokens: Number(row?.cache_creation_tokens ?? 0),
    cache_read_tokens: Number(row?.cache_read_tokens ?? 0),
  };
}

export function mapAiUsageGroupRows(rows: AiUsageGroupRow[]): AiUsageGroup[] {
  return rows.map((row) => ({
    key: row.key ?? 'unknown',
    ...mapAiUsageTotalsRow(row),
  }));
}

const TOP_USER_ROWS = 20;

export class AiUsageMetricsRepository
  implements
    IAiUsageMetricsRepository,
    IAiSpendReader,
    IAnonymousPassSpendReader,
    IAiRequestCostReader
{
  constructor(private readonly database: Knex) {}

  private usageSums(): Knex.Raw[] {
    return [
      this.database.raw('count(*) as calls'),
      this.database.raw(
        "coalesce(sum((props->>'cost_usd')::numeric), 0) as cost_usd"
      ),
      this.database.raw(
        "coalesce(sum((props->'usage'->>'input_tokens')::bigint), 0) as input_tokens"
      ),
      this.database.raw(
        "coalesce(sum((props->'usage'->>'output_tokens')::bigint), 0) as output_tokens"
      ),
      this.database.raw(
        "coalesce(sum((props->'usage'->>'cache_creation_input_tokens')::bigint), 0) as cache_creation_tokens"
      ),
      this.database.raw(
        "coalesce(sum((props->'usage'->>'cache_read_input_tokens')::bigint), 0) as cache_read_tokens"
      ),
    ];
  }

  private baseQuery(since: Date): Knex.QueryBuilder {
    return this.database('events')
      .where('name', AI_USAGE_EVENT)
      .where('created_at', '>=', since);
  }

  buildTotalsQuery(since: Date): Knex.QueryBuilder {
    return this.baseQuery(since).select(...this.usageSums());
  }

  buildBySurfaceQuery(since: Date): Knex.QueryBuilder {
    return this.baseQuery(since)
      .select(
        this.database.raw("props->>'surface' as key"),
        ...this.usageSums()
      )
      .groupByRaw("props->>'surface'")
      .orderByRaw('cost_usd desc');
  }

  buildByModelQuery(since: Date): Knex.QueryBuilder {
    return this.baseQuery(since)
      .select(this.database.raw("props->>'model' as key"), ...this.usageSums())
      .groupByRaw("props->>'model'")
      .orderByRaw('cost_usd desc');
  }

  buildByUserQuery(since: Date): Knex.QueryBuilder {
    return this.baseQuery(since)
      .select(this.database.raw('user_id::text as key'), ...this.usageSums())
      .groupBy('user_id')
      .orderByRaw('cost_usd desc')
      .limit(TOP_USER_ROWS);
  }

  // Spend made on a pass before its buyer had an account is recorded against
  // the pass id. Once the account claims that pass, the spend is the
  // account's too, or claiming a pass would hand its allowance back. The
  // claimed ids are read first so both halves of the OR stay index scans.
  buildUserCostQuery(
    userId: number,
    since: Date,
    claimedPassIds: number[] = []
  ): Knex.QueryBuilder {
    const scoped =
      claimedPassIds.length === 0
        ? this.baseQuery(since).where('user_id', userId)
        : this.baseQuery(since).where((scope) =>
            scope
              .where('user_id', userId)
              .orWhereIn('anonymous_pass_id', claimedPassIds)
          );
    return scoped.select(
      this.database.raw(
        "coalesce(sum((props->>'cost_usd')::numeric), 0) as cost_usd"
      )
    );
  }

  buildAnonymousPassCostQuery(
    anonymousPassId: number,
    since: Date
  ): Knex.QueryBuilder {
    return this.baseQuery(since)
      .where('anonymous_pass_id', anonymousPassId)
      .select(
        this.database.raw(
          "coalesce(sum((props->>'cost_usd')::numeric), 0) as cost_usd"
        )
      );
  }

  buildAnonymousPassEventCountQuery(
    name: string,
    anonymousPassId: number,
    since: Date
  ): Knex.QueryBuilder {
    return this.database('events')
      .where('name', name)
      .where('anonymous_pass_id', anonymousPassId)
      .where('created_at', '>=', since)
      .count('* as count');
  }

  buildCostByRequestQuery(
    userId: number,
    requestId: string,
    since: Date
  ): Knex.QueryBuilder {
    return this.baseQuery(since)
      .where('user_id', userId)
      .whereRaw("props->>'request_id' = ?", [requestId])
      .select(
        this.database.raw(
          "coalesce(sum((props->>'cost_usd')::numeric), 0) as cost_usd"
        )
      );
  }

  buildEventCountQuery(
    name: string,
    userId: number,
    since: Date
  ): Knex.QueryBuilder {
    return this.database('events')
      .select(
        this.database.raw(
          'case when count(*) filter (where props @> ?::jsonb) > 0 ' +
            'then count(*) filter (where props @> ?::jsonb) else count(*) end as count',
          [SERVER_MARKER_JSON, SERVER_MARKER_JSON]
        )
      )
      .where('name', name)
      .where('user_id', userId)
      .where('created_at', '>=', since);
  }

  buildByDayQuery(since: Date): Knex.QueryBuilder {
    return this.baseQuery(since)
      .select(
        this.database.raw(
          "to_char(date_trunc('day', created_at), 'YYYY-MM-DD') as key"
        ),
        ...this.usageSums()
      )
      .groupByRaw("date_trunc('day', created_at)")
      .orderByRaw("date_trunc('day', created_at)");
  }

  async totalsSince(since: Date): Promise<AiUsageTotals> {
    const row = (await this.buildTotalsQuery(since).first()) as
      | AiUsageTotalsRow
      | undefined;
    return mapAiUsageTotalsRow(row);
  }

  async totalsBySurface(since: Date): Promise<AiUsageGroup[]> {
    const rows = (await this.buildBySurfaceQuery(since)) as AiUsageGroupRow[];
    return mapAiUsageGroupRows(rows);
  }

  async totalsByModel(since: Date): Promise<AiUsageGroup[]> {
    const rows = (await this.buildByModelQuery(since)) as AiUsageGroupRow[];
    return mapAiUsageGroupRows(rows);
  }

  async totalsByUser(since: Date): Promise<AiUsageGroup[]> {
    const rows = (await this.buildByUserQuery(since)) as AiUsageGroupRow[];
    return mapAiUsageGroupRows(rows);
  }

  async userCostSince(userId: number, since: Date): Promise<number> {
    const claimed = (await this.database('anonymous_passes')
      .select('id')
      .where('claimed_by_user_id', userId)) as { id: number | string }[];
    const claimedPassIds = claimed.map((row) => Number(row.id));
    const row = (await this.buildUserCostQuery(
      userId,
      since,
      claimedPassIds
    ).first()) as { cost_usd: number | string } | undefined;
    return Number(row?.cost_usd ?? 0);
  }

  async anonymousPassCostSince(
    anonymousPassId: number,
    since: Date
  ): Promise<number> {
    const row = (await this.buildAnonymousPassCostQuery(
      anonymousPassId,
      since
    ).first()) as { cost_usd: number | string } | undefined;
    return Number(row?.cost_usd ?? 0);
  }

  async anonymousPassEventCountSince(
    name: string,
    anonymousPassId: number,
    since: Date
  ): Promise<number> {
    const row = (await this.buildAnonymousPassEventCountQuery(
      name,
      anonymousPassId,
      since
    ).first()) as { count: number | string } | undefined;
    return Number(row?.count ?? 0);
  }

  async costByRequestId(
    userId: number,
    requestId: string,
    since: Date
  ): Promise<number> {
    const row = (await this.buildCostByRequestQuery(
      userId,
      requestId,
      since
    ).first()) as { cost_usd: number | string } | undefined;
    return Number(row?.cost_usd ?? 0);
  }

  async eventCountSince(
    name: string,
    userId: number,
    since: Date
  ): Promise<number> {
    const row = (await this.buildEventCountQuery(
      name,
      userId,
      since
    ).first()) as { count: number | string } | undefined;
    return Number(row?.count ?? 0);
  }

  async totalsByDay(since: Date): Promise<AiUsageGroup[]> {
    const rows = (await this.buildByDayQuery(since)) as AiUsageGroupRow[];
    return mapAiUsageGroupRows(rows);
  }
}

export default AiUsageMetricsRepository;
