import type { Knex } from 'knex';

export interface ISubscriptionRecoveryNotificationsRepository {
  wasNotifiedSince(emailHash: string, since: Date): Promise<boolean>;
  recordNotified(emailHash: string): Promise<void>;
  forgetNotified(emailHash: string): Promise<void>;
}

export class SubscriptionRecoveryNotificationsRepository implements ISubscriptionRecoveryNotificationsRepository {
  constructor(private readonly database: Knex) {}

  async wasNotifiedSince(emailHash: string, since: Date): Promise<boolean> {
    const row = await this.database('subscription_recovery_notifications')
      .where({ email_hash: emailHash })
      .where('notified_at', '>=', since)
      .first();
    return row != null;
  }

  async recordNotified(emailHash: string): Promise<void> {
    await this.database('subscription_recovery_notifications').insert({
      email_hash: emailHash,
    });
  }

  async forgetNotified(emailHash: string): Promise<void> {
    await this.database('subscription_recovery_notifications')
      .where({ email_hash: emailHash })
      .del();
  }
}

export class InMemorySubscriptionRecoveryNotificationsRepository implements ISubscriptionRecoveryNotificationsRepository {
  private readonly rows: Array<{ emailHash: string; notifiedAt: Date }> = [];

  async wasNotifiedSince(emailHash: string, since: Date): Promise<boolean> {
    return this.rows.some(
      (row) => row.emailHash === emailHash && row.notifiedAt >= since
    );
  }

  async recordNotified(emailHash: string): Promise<void> {
    this.rows.push({ emailHash, notifiedAt: new Date() });
  }

  async forgetNotified(emailHash: string): Promise<void> {
    for (let i = this.rows.length - 1; i >= 0; i -= 1) {
      if (this.rows[i].emailHash === emailHash) {
        this.rows.splice(i, 1);
      }
    }
  }
}

export default SubscriptionRecoveryNotificationsRepository;
