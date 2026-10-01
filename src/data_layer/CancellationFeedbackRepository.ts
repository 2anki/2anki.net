import type { Knex } from 'knex';

import type {
  CancellationCommentEntry,
  CancellationReasonCount,
} from '../types/ops/feedbackRows';

export type { CancellationCommentEntry, CancellationReasonCount };

export interface ICancellationFeedbackRepository {
  countByReason(since: Date): Promise<CancellationReasonCount[]>;
  recentComments(limit: number): Promise<CancellationCommentEntry[]>;
}

interface ReasonRow {
  reason: string;
  count: string | number;
}

interface CommentRow {
  reason: string;
  comment: string;
  created_at: Date | string;
}

const toIso = (value: Date | string): string =>
  typeof value === 'string' ? value : value.toISOString();

export class CancellationFeedbackRepository implements ICancellationFeedbackRepository {
  private readonly table = 'cancellation_feedback';

  constructor(private readonly database: Knex) {}

  async countByReason(since: Date): Promise<CancellationReasonCount[]> {
    const rows = await this.database(this.table)
      .select('reason')
      .count<ReasonRow[]>('* as count')
      .where('created_at', '>=', since)
      .groupBy('reason')
      .orderBy('count', 'desc');
    return rows.map((row) => ({
      reason: row.reason,
      count: Number(row.count),
    }));
  }

  async recentComments(limit: number): Promise<CancellationCommentEntry[]> {
    const rows = await this.database<CommentRow>(this.table)
      .select('reason', 'comment', 'created_at')
      .whereNotNull('comment')
      .andWhere('comment', '!=', '')
      .orderBy('created_at', 'desc')
      .limit(limit);
    return rows.map((row) => ({
      reason: row.reason,
      comment: row.comment,
      created_at: toIso(row.created_at),
    }));
  }
}

export class InMemoryCancellationFeedbackRepository implements ICancellationFeedbackRepository {
  private readonly rows: Array<{
    reason: string;
    comment: string | null;
    created_at: Date;
  }> = [];

  insert(row: {
    reason: string;
    comment?: string | null;
    created_at?: Date;
  }): void {
    this.rows.push({
      reason: row.reason,
      comment: row.comment ?? null,
      created_at: row.created_at ?? new Date(),
    });
  }

  async countByReason(since: Date): Promise<CancellationReasonCount[]> {
    const counts = new Map<string, number>();
    for (const row of this.rows) {
      if (row.created_at >= since) {
        counts.set(row.reason, (counts.get(row.reason) ?? 0) + 1);
      }
    }
    return Array.from(counts.entries())
      .map(([reason, count]) => ({ reason, count }))
      .sort((a, b) => b.count - a.count);
  }

  async recentComments(limit: number): Promise<CancellationCommentEntry[]> {
    return this.rows
      .filter(
        (r): r is { reason: string; comment: string; created_at: Date } =>
          r.comment != null && r.comment !== ''
      )
      .sort((a, b) => b.created_at.getTime() - a.created_at.getTime())
      .slice(0, limit)
      .map((r) => ({
        reason: r.reason,
        comment: r.comment,
        created_at: r.created_at.toISOString(),
      }));
  }

  clear(): void {
    this.rows.length = 0;
  }
}

export default CancellationFeedbackRepository;
