import type { Knex } from 'knex';

export interface AccountDeletionTarget {
  id: number;
  email: string;
  created_at: Date | null;
  last_login_at: Date | null;
}

export interface AccountActivityCounts {
  jobs: number;
  uploads: number;
}

export class AccountDeletionPreviewRepository {
  constructor(private readonly database: Knex) {}

  findUserByEmail(email: string): Promise<AccountDeletionTarget | undefined> {
    return this.database('users')
      .select('id', 'email', 'created_at', 'last_login_at')
      .whereRaw('lower(email) = ?', [email.trim().toLowerCase()])
      .first();
  }

  async countActivity(userId: number): Promise<AccountActivityCounts> {
    const [jobs] = await this.database('jobs')
      .where({ owner: String(userId) })
      .count({ count: '*' });
    const [uploads] = await this.database('uploads')
      .where({ owner: userId })
      .count({ count: '*' });
    return {
      jobs: Number(jobs?.count ?? 0),
      uploads: Number(uploads?.count ?? 0),
    };
  }
}
