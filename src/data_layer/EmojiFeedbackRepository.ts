import type { Knex } from 'knex';

import type {
  EmojiFeedbackCommentEntry,
  EmojiFeedbackRatingCount,
} from '../types/ops/feedbackRows';

export type { EmojiFeedbackCommentEntry, EmojiFeedbackRatingCount };

interface EmojiFeedbackEntry {
  rating: number;
  comment: string | null;
  page: string;
  email: string | null;
}

export interface IEmojiFeedbackRepository {
  insert(entry: EmojiFeedbackEntry): Promise<void>;
  countByRating(since: Date): Promise<EmojiFeedbackRatingCount[]>;
  recentComments(limit: number): Promise<EmojiFeedbackCommentEntry[]>;
}

interface RatingRow {
  rating: number;
  count: string | number;
}

interface CommentRow {
  rating: number;
  comment: string;
  page: string;
  created_at: Date | string;
}

const toIso = (value: Date | string): string =>
  typeof value === 'string' ? value : value.toISOString();

export class EmojiFeedbackRepository implements IEmojiFeedbackRepository {
  private readonly table = 'emoji_feedback';

  constructor(private readonly database: Knex) {}

  async insert(entry: EmojiFeedbackEntry): Promise<void> {
    await this.database(this.table).insert({
      rating: entry.rating,
      comment: entry.comment,
      page: entry.page,
      email: entry.email,
    });
  }

  async countByRating(since: Date): Promise<EmojiFeedbackRatingCount[]> {
    const rows = await this.database(this.table)
      .select('rating')
      .count<RatingRow[]>('* as count')
      .where('created_at', '>=', since)
      .groupBy('rating')
      .orderBy('rating', 'asc');
    return rows.map((row) => ({
      rating: row.rating,
      count: Number(row.count),
    }));
  }

  async recentComments(limit: number): Promise<EmojiFeedbackCommentEntry[]> {
    const rows = await this.database<CommentRow>(this.table)
      .select('rating', 'comment', 'page', 'created_at')
      .whereNotNull('comment')
      .andWhere('comment', '!=', '')
      .orderBy('created_at', 'desc')
      .limit(limit);
    return rows.map((row) => ({
      rating: row.rating,
      comment: row.comment,
      page: row.page,
      created_at: toIso(row.created_at),
    }));
  }
}

export class InMemoryEmojiFeedbackRepository implements IEmojiFeedbackRepository {
  private readonly rows: Array<{
    rating: number;
    comment: string | null;
    page: string;
    email: string | null;
    created_at: Date;
  }> = [];

  async insert(entry: EmojiFeedbackEntry): Promise<void> {
    this.rows.push({ ...entry, created_at: new Date() });
  }

  async countByRating(since: Date): Promise<EmojiFeedbackRatingCount[]> {
    const counts = new Map<number, number>();
    for (const row of this.rows) {
      if (row.created_at >= since) {
        counts.set(row.rating, (counts.get(row.rating) ?? 0) + 1);
      }
    }
    return Array.from(counts.entries())
      .map(([rating, count]) => ({ rating, count }))
      .sort((a, b) => a.rating - b.rating);
  }

  async recentComments(limit: number): Promise<EmojiFeedbackCommentEntry[]> {
    return this.rows
      .filter(
        (
          r
        ): r is {
          rating: number;
          comment: string;
          page: string;
          email: string | null;
          created_at: Date;
        } => r.comment != null && r.comment !== ''
      )
      .sort((a, b) => b.created_at.getTime() - a.created_at.getTime())
      .slice(0, limit)
      .map((r) => ({
        rating: r.rating,
        comment: r.comment,
        page: r.page,
        created_at: r.created_at.toISOString(),
      }));
  }
}
