import type { Knex } from 'knex';

import type { ErrorSurfaceCount } from '../types/ops/Performance';

export type { ErrorSurfaceCount };

export interface RecordErrorInput {
  userId: number | null;
  surface: string;
  code: string;
  context?: Record<string, unknown> | null;
}

export interface IUserVisibleErrorsRepository {
  record(input: RecordErrorInput): Promise<void>;
  countBySurfaceAndCode(sinceDays: number): Promise<ErrorSurfaceCount[]>;
}

interface CountRow {
  surface: string;
  code: string;
  count: string | number;
}

export class UserVisibleErrorsRepository implements IUserVisibleErrorsRepository {
  private readonly table = 'user_visible_errors';

  constructor(private readonly database: Knex) {}

  async record(input: RecordErrorInput): Promise<void> {
    await this.database(this.table).insert({
      user_id: input.userId,
      surface: input.surface,
      code: input.code,
      context: input.context != null ? JSON.stringify(input.context) : null,
    });
  }

  async countBySurfaceAndCode(sinceDays: number): Promise<ErrorSurfaceCount[]> {
    const rows = (await this.database(this.table)
      .where(
        'occurred_at',
        '>=',
        this.database.raw("NOW() - (? * INTERVAL '1 day')", [sinceDays])
      )
      .select('surface', 'code')
      .count<CountRow[]>('* as count')
      .groupBy('surface', 'code')
      .orderBy('count', 'desc')) as CountRow[];
    return rows.map((row) => ({
      surface: row.surface,
      code: row.code,
      count: Number(row.count),
    }));
  }
}

export class InMemoryUserVisibleErrorsRepository implements IUserVisibleErrorsRepository {
  private readonly rows: Array<{
    userId: number | null;
    surface: string;
    code: string;
    context: Record<string, unknown> | null;
    occurred_at: Date;
  }> = [];

  async record(input: RecordErrorInput): Promise<void> {
    this.rows.push({
      userId: input.userId,
      surface: input.surface,
      code: input.code,
      context: input.context ?? null,
      occurred_at: new Date(),
    });
  }

  async countBySurfaceAndCode(sinceDays: number): Promise<ErrorSurfaceCount[]> {
    const since = new Date(Date.now() - sinceDays * 24 * 60 * 60 * 1000);
    const counts = new Map<string, number>();
    for (const row of this.rows) {
      if (row.occurred_at >= since) {
        const key = `${row.surface}::${row.code}`;
        counts.set(key, (counts.get(key) ?? 0) + 1);
      }
    }
    return Array.from(counts.entries())
      .map((entry) => {
        const [surface, code] = entry[0].split('::');
        return { surface, code, count: entry[1] };
      })
      .sort((a, b) => b.count - a.count);
  }
}
