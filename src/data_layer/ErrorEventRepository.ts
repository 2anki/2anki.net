import type { Knex } from 'knex';

import type { ErrorGroupRow, ResolutionStatus } from '../types/ops/Errors';

export type { ErrorGroupRow, ResolutionStatus };

export interface ErrorEventInsert {
  source: 'web' | 'server';
  message_hash: string;
  message: string;
  stack?: string | null;
  url?: string | null;
  user_agent?: string | null;
  release?: string | null;
  user_id?: number | null;
  ip_hash?: string | null;
  context?: Record<string, unknown> | null;
}

export interface ListErrorGroupsOptions {
  limit: number;
  offset: number;
  source?: 'web' | 'server';
  sort?: 'last_seen' | 'occurrences';
  status?: ResolutionStatus;
}

export interface ErrorSampleRow {
  message_hash: string;
  stack: string | null;
  url: string | null;
  user_agent: string | null;
  release: string | null;
  user_id: number | null;
}

export interface IErrorEventRepository {
  insert(row: ErrorEventInsert): Promise<void>;
  existsWithinWindow(
    messageHash: string,
    ipHash: string,
    windowMs: number
  ): Promise<boolean>;
  listGroups(options: ListErrorGroupsOptions): Promise<ErrorGroupRow[]>;
  countGroups(
    source?: 'web' | 'server',
    status?: ResolutionStatus
  ): Promise<number>;
  latestSamples(messageHashes: string[]): Promise<ErrorSampleRow[]>;
  resolveGroup(messageHash: string, resolvedBy: number | null): Promise<void>;
  reopenGroup(messageHash: string): Promise<void>;
}

export function buildLatestSamplesQuery(
  database: Knex,
  messageHashes: string[]
): Knex.QueryBuilder {
  const latestIds = database('error_events')
    .max('id as id')
    .whereIn('message_hash', messageHashes)
    .groupBy('message_hash');
  return database('error_events')
    .select('message_hash', 'stack', 'url', 'user_agent', 'release', 'user_id')
    .whereIn('id', latestIds);
}

const RESOLVED_PREDICATE = 'MAX(r.resolved_at) >= MAX(e.created_at)';
const UNRESOLVED_PREDICATE =
  '(MAX(r.resolved_at) IS NULL OR MAX(r.resolved_at) < MAX(e.created_at))';

export class ErrorEventRepository implements IErrorEventRepository {
  private readonly table = 'error_events';
  private readonly resolutionsTable = 'error_resolutions';

  constructor(private readonly database: Knex) {}

  private applyStatusFilter(
    query: Knex.QueryBuilder,
    status: ResolutionStatus | undefined
  ): void {
    if (status === 'resolved') {
      query.havingRaw(RESOLVED_PREDICATE);
    } else if (status === 'unresolved') {
      query.havingRaw(UNRESOLVED_PREDICATE);
    }
  }

  async insert(row: ErrorEventInsert): Promise<void> {
    await this.database(this.table).insert(row);
  }

  async existsWithinWindow(
    messageHash: string,
    ipHash: string,
    windowMs: number
  ): Promise<boolean> {
    const since = new Date(Date.now() - windowMs);
    const result = await this.database(this.table)
      .where('message_hash', messageHash)
      .where('ip_hash', ipHash)
      .where('created_at', '>=', since)
      .count('id as count')
      .first();
    return Number(result?.count ?? 0) > 0;
  }

  async listGroups(options: ListErrorGroupsOptions): Promise<ErrorGroupRow[]> {
    const { limit, offset, source, sort, status } = options;
    const orderCol = sort === 'occurrences' ? 'occurrences' : 'last_seen';

    const query = this.database(`${this.table} as e`)
      .leftJoin(
        `${this.resolutionsTable} as r`,
        'e.message_hash',
        'r.message_hash'
      )
      .select(
        'e.message_hash as message_hash',
        'e.message as message',
        this.database.raw('MAX(e.stack) as stack'),
        this.database.raw('MAX(e.url) as url'),
        this.database.raw('MAX(e.release) as release'),
        'e.source as source',
        this.database.raw('MAX(e.user_id) as user_id'),
        this.database.raw('MAX(e.user_agent) as user_agent'),
        this.database.raw('MIN(e.created_at) as first_seen'),
        this.database.raw('MAX(e.created_at) as last_seen'),
        this.database.raw('COUNT(*) as occurrences'),
        this.database.raw('MAX(r.resolved_at) as resolved_at'),
        this.database.raw(`(${RESOLVED_PREDICATE}) as resolved`)
      )
      .groupBy('e.message_hash', 'e.message', 'e.source')
      .orderBy(orderCol, 'desc')
      .limit(limit)
      .offset(offset);

    if (source != null) {
      query.where('e.source', source);
    }

    this.applyStatusFilter(query, status);

    const rows = await query;
    return rows.map((r) => ({
      message_hash: r.message_hash as string,
      message: r.message as string,
      stack: r.stack as string | null,
      url: r.url as string | null,
      release: r.release as string | null,
      source: r.source as string,
      user_id: r.user_id == null ? null : Number(r.user_id),
      user_agent: r.user_agent as string | null,
      first_seen:
        r.first_seen instanceof Date
          ? r.first_seen.toISOString()
          : String(r.first_seen),
      last_seen:
        r.last_seen instanceof Date
          ? r.last_seen.toISOString()
          : String(r.last_seen),
      occurrences: Number(r.occurrences),
      resolved: r.resolved === true,
      resolved_at:
        r.resolved_at == null
          ? null
          : r.resolved_at instanceof Date
            ? r.resolved_at.toISOString()
            : String(r.resolved_at),
    }));
  }

  async countGroups(
    source?: 'web' | 'server',
    status?: ResolutionStatus
  ): Promise<number> {
    const inner = this.database(`${this.table} as e`)
      .leftJoin(
        `${this.resolutionsTable} as r`,
        'e.message_hash',
        'r.message_hash'
      )
      .select('e.message_hash')
      .groupBy('e.message_hash', 'e.message', 'e.source');

    if (source != null) {
      inner.where('e.source', source);
    }

    this.applyStatusFilter(inner, status);

    const result = await this.database
      .count('* as total')
      .from(inner.as('groups'))
      .first();
    return Number(result?.total ?? 0);
  }

  async latestSamples(messageHashes: string[]): Promise<ErrorSampleRow[]> {
    if (messageHashes.length === 0) {
      return [];
    }
    const rows = await buildLatestSamplesQuery(this.database, messageHashes);
    return rows.map((r: Record<string, unknown>) => ({
      message_hash: r.message_hash as string,
      stack: (r.stack as string | null) ?? null,
      url: (r.url as string | null) ?? null,
      user_agent: (r.user_agent as string | null) ?? null,
      release: (r.release as string | null) ?? null,
      user_id: r.user_id == null ? null : Number(r.user_id),
    }));
  }

  async resolveGroup(
    messageHash: string,
    resolvedBy: number | null
  ): Promise<void> {
    await this.database(this.resolutionsTable)
      .insert({
        message_hash: messageHash,
        resolved_at: this.database.fn.now(),
        resolved_by: resolvedBy,
      })
      .onConflict('message_hash')
      .merge(['resolved_at', 'resolved_by']);
  }

  async reopenGroup(messageHash: string): Promise<void> {
    await this.database(this.resolutionsTable)
      .where('message_hash', messageHash)
      .del();
  }
}
