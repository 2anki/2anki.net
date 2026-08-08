import type { Knex } from 'knex';

export interface NewSubscriptionWithUserRow {
  userId: number;
  createdAt: Date;
}

export interface INewSubscriptionsRepository {
  listNewWithUserId(
    since: Date,
    until: Date
  ): Promise<NewSubscriptionWithUserRow[]>;
}

export function buildNewSubscriptionsQuery(
  database: Knex,
  since: Date,
  until: Date
): Knex.QueryBuilder {
  return database('subscriptions')
    .joinRaw(
      'join users on lower(trim(users.email)) = lower(trim(subscriptions.email))'
    )
    .where('subscriptions.created_at', '>=', since)
    .where('subscriptions.created_at', '<=', until)
    .select('users.id as user_id', 'subscriptions.created_at as created_at');
}

export class PaidValueSubscriptionsRepository implements INewSubscriptionsRepository {
  constructor(private readonly database: Knex) {}

  async listNewWithUserId(
    since: Date,
    until: Date
  ): Promise<NewSubscriptionWithUserRow[]> {
    const rows = (await buildNewSubscriptionsQuery(
      this.database,
      since,
      until
    )) as Array<{ user_id: number; created_at: Date | string }>;
    return rows.map((row) => ({
      userId: Number(row.user_id),
      createdAt:
        row.created_at instanceof Date
          ? row.created_at
          : new Date(row.created_at),
    }));
  }
}

export default PaidValueSubscriptionsRepository;
