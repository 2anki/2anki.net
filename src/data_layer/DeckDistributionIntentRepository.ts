import type { Knex } from 'knex';

export interface DeckDistributionIntentEntry {
  answer: string;
  notify_email: string | null;
  user_id: number;
  upload_key: string;
}

export interface DeckDistributionAnswerCount {
  answer: string;
  count: number;
}

export interface IDeckDistributionIntentRepository {
  record(entry: DeckDistributionIntentEntry): Promise<void>;
  countByAnswer(): Promise<DeckDistributionAnswerCount[]>;
}

interface CountRow {
  answer: string;
  count: string | number;
}

export class DeckDistributionIntentRepository implements IDeckDistributionIntentRepository {
  private readonly table = 'deck_distribution_intent';

  constructor(private readonly database: Knex) {}

  buildRecordQuery(entry: DeckDistributionIntentEntry): Knex.QueryBuilder {
    return this.database(this.table).insert({
      answer: entry.answer,
      notify_email: entry.notify_email,
      user_id: entry.user_id,
      upload_key: entry.upload_key,
    });
  }

  async record(entry: DeckDistributionIntentEntry): Promise<void> {
    await this.buildRecordQuery(entry);
  }

  buildCountQuery(): Knex.QueryBuilder {
    return this.database(this.table)
      .select('answer')
      .count('* as count')
      .groupBy('answer')
      .orderBy('count', 'desc');
  }

  async countByAnswer(): Promise<DeckDistributionAnswerCount[]> {
    const rows = (await this.buildCountQuery()) as CountRow[];
    return rows.map((row) => ({
      answer: row.answer,
      count: Number(row.count),
    }));
  }
}

export class InMemoryDeckDistributionIntentRepository implements IDeckDistributionIntentRepository {
  private readonly rows: DeckDistributionIntentEntry[] = [];

  async record(entry: DeckDistributionIntentEntry): Promise<void> {
    this.rows.push({ ...entry });
  }

  async countByAnswer(): Promise<DeckDistributionAnswerCount[]> {
    const counts = new Map<string, number>();
    for (const row of this.rows) {
      counts.set(row.answer, (counts.get(row.answer) ?? 0) + 1);
    }
    return Array.from(counts.entries())
      .map(([answer, count]) => ({ answer, count }))
      .sort((a, b) => b.count - a.count);
  }

  all(): DeckDistributionIntentEntry[] {
    return [...this.rows];
  }
}
