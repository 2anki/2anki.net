import type { Knex } from 'knex';

import type {
  ReEngagementCommentEntry,
  ReEngagementReasonCount,
} from '../types/ops/feedbackRows';

export type { ReEngagementCommentEntry, ReEngagementReasonCount };

export interface IReEngagementFeedbackRepository {
  countByReason(since: Date): Promise<ReEngagementReasonCount[]>;
  recentComments(limit: number): Promise<ReEngagementCommentEntry[]>;
}

interface ReasonRow {
  stopped_reason: string;
  count: string | number;
}

interface CommentRow {
  stopped_reason: string;
  content_type: string;
  comment: string;
  created_at: Date | string;
}

const toIso = (value: Date | string): string =>
  typeof value === 'string' ? value : value.toISOString();

export class ReEngagementFeedbackRepository implements IReEngagementFeedbackRepository {
  private readonly table = 're_engagement_feedback';

  constructor(private readonly database: Knex) {}

  async countByReason(since: Date): Promise<ReEngagementReasonCount[]> {
    const rows = await this.database(this.table)
      .select('stopped_reason')
      .count<ReasonRow[]>('* as count')
      .where('created_at', '>=', since)
      .groupBy('stopped_reason')
      .orderBy('count', 'desc');
    return rows.map((row) => ({
      stopped_reason: row.stopped_reason,
      count: Number(row.count),
    }));
  }

  async recentComments(limit: number): Promise<ReEngagementCommentEntry[]> {
    const rows = await this.database<CommentRow>(this.table)
      .select('stopped_reason', 'content_type', 'comment', 'created_at')
      .whereNotNull('comment')
      .andWhere('comment', '!=', '')
      .orderBy('created_at', 'desc')
      .limit(limit);
    return rows.map((row) => ({
      stopped_reason: row.stopped_reason,
      content_type: row.content_type,
      comment: row.comment,
      created_at: toIso(row.created_at),
    }));
  }
}

export class InMemoryReEngagementFeedbackRepository implements IReEngagementFeedbackRepository {
  private readonly rows: Array<{
    stopped_reason: string;
    content_type: string;
    comment: string | null;
    created_at: Date;
  }> = [];

  insert(row: {
    stopped_reason: string;
    content_type: string;
    comment?: string | null;
    created_at?: Date;
  }): void {
    this.rows.push({
      stopped_reason: row.stopped_reason,
      content_type: row.content_type,
      comment: row.comment ?? null,
      created_at: row.created_at ?? new Date(),
    });
  }

  async countByReason(since: Date): Promise<ReEngagementReasonCount[]> {
    const counts = new Map<string, number>();
    for (const row of this.rows) {
      if (row.created_at >= since) {
        counts.set(
          row.stopped_reason,
          (counts.get(row.stopped_reason) ?? 0) + 1
        );
      }
    }
    return Array.from(counts.entries())
      .map(([stopped_reason, count]) => ({ stopped_reason, count }))
      .sort((a, b) => b.count - a.count);
  }

  async recentComments(limit: number): Promise<ReEngagementCommentEntry[]> {
    return this.rows
      .filter(
        (
          r
        ): r is {
          stopped_reason: string;
          content_type: string;
          comment: string;
          created_at: Date;
        } => r.comment != null && r.comment !== ''
      )
      .sort((a, b) => b.created_at.getTime() - a.created_at.getTime())
      .slice(0, limit)
      .map((r) => ({
        stopped_reason: r.stopped_reason,
        content_type: r.content_type,
        comment: r.comment,
        created_at: r.created_at.toISOString(),
      }));
  }

  clear(): void {
    this.rows.length = 0;
  }
}

export default ReEngagementFeedbackRepository;
