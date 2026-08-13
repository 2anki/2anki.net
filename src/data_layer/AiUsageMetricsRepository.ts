import type { Knex } from 'knex';

const AI_USAGE_EVENT = 'ai_usage_recorded';

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

export interface AiUsageTotals {
  calls: number;
  cost_usd: number;
  input_tokens: number;
  output_tokens: number;
  cache_creation_tokens: number;
  cache_read_tokens: number;
}

export interface AiUsageGroup extends AiUsageTotals {
  key: string;
}

export interface IAiUsageMetricsRepository {
  totalsSince(since: Date): Promise<AiUsageTotals>;
  totalsBySurface(since: Date): Promise<AiUsageGroup[]>;
  totalsByModel(since: Date): Promise<AiUsageGroup[]>;
  totalsByDay(since: Date): Promise<AiUsageGroup[]>;
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

export class AiUsageMetricsRepository implements IAiUsageMetricsRepository {
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

  async totalsByDay(since: Date): Promise<AiUsageGroup[]> {
    const rows = (await this.buildByDayQuery(since)) as AiUsageGroupRow[];
    return mapAiUsageGroupRows(rows);
  }
}

export default AiUsageMetricsRepository;
