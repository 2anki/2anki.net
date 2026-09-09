import type { Knex } from 'knex';

import type { BusinessMetricKey } from '../services/ops/BusinessMetricsService';

export type StripeSourceCacheKey = '_stripe_subs' | '_stripe_invoices';
export type TodaySnapshotCacheKey = '_today_snapshot';
export type BusinessCacheKey =
  | BusinessMetricKey
  | StripeSourceCacheKey
  | TodaySnapshotCacheKey;

export interface BusinessMetricsCacheEntry {
  key: BusinessCacheKey;
  value: unknown;
  cachedAt: Date;
  expiresAt: Date;
}

export interface IBusinessMetricsCacheRepository {
  loadAll(): Promise<BusinessMetricsCacheEntry[]>;
  load(key: BusinessCacheKey): Promise<BusinessMetricsCacheEntry | null>;
  upsertMany(entries: BusinessMetricsCacheEntry[]): Promise<void>;
}

interface BusinessMetricsCacheRow {
  metric_key: string;
  value: unknown;
  cached_at: Date | string;
  expires_at: Date | string;
}

const toEntry = (row: BusinessMetricsCacheRow): BusinessMetricsCacheEntry => ({
  key: row.metric_key as BusinessCacheKey,
  value: row.value,
  cachedAt: new Date(row.cached_at),
  expiresAt: new Date(row.expires_at),
});

export class BusinessMetricsCacheRepository implements IBusinessMetricsCacheRepository {
  private readonly table = 'business_metrics_cache';

  constructor(private readonly database: Knex) {}

  async loadAll(): Promise<BusinessMetricsCacheEntry[]> {
    const rows = await this.database<BusinessMetricsCacheRow>(
      this.table
    ).select('metric_key', 'value', 'cached_at', 'expires_at');
    return rows.map(toEntry);
  }

  buildLoadQuery(key: BusinessCacheKey): Knex.QueryBuilder {
    return this.database<BusinessMetricsCacheRow>(this.table)
      .select('metric_key', 'value', 'cached_at', 'expires_at')
      .where('metric_key', key)
      .first();
  }

  async load(key: BusinessCacheKey): Promise<BusinessMetricsCacheEntry | null> {
    const row = (await this.buildLoadQuery(key)) as
      | BusinessMetricsCacheRow
      | undefined;
    return row == null ? null : toEntry(row);
  }

  async upsertMany(entries: BusinessMetricsCacheEntry[]): Promise<void> {
    if (entries.length === 0) return;
    const rows = entries.map((entry) => ({
      metric_key: entry.key,
      value: JSON.stringify(entry.value),
      cached_at: entry.cachedAt,
      expires_at: entry.expiresAt,
    }));
    await this.database(this.table)
      .insert(rows)
      .onConflict('metric_key')
      .merge();
  }
}

export class InMemoryBusinessMetricsCacheRepository implements IBusinessMetricsCacheRepository {
  private readonly entries = new Map<
    BusinessCacheKey,
    BusinessMetricsCacheEntry
  >();

  async loadAll(): Promise<BusinessMetricsCacheEntry[]> {
    return Array.from(this.entries.values()).map((entry) => ({ ...entry }));
  }

  async load(key: BusinessCacheKey): Promise<BusinessMetricsCacheEntry | null> {
    const entry = this.entries.get(key);
    return entry == null ? null : { ...entry };
  }

  async upsertMany(entries: BusinessMetricsCacheEntry[]): Promise<void> {
    for (const entry of entries) {
      this.entries.set(entry.key, { ...entry });
    }
  }

  clear(): void {
    this.entries.clear();
  }
}

export default BusinessMetricsCacheRepository;
