import type { Knex } from 'knex';

export type FeedbackPlan = 'lifetime' | 'subscriber' | 'free';

export interface LowRatingAccountContext {
  email: string;
  userId: string;
  latestJobId: number | null;
  latestJobStatus: string | null;
  plan: FeedbackPlan;
}

export interface ILowRatingContextRepository {
  getByOwner(owner: number): Promise<LowRatingAccountContext | null>;
}

export class LowRatingContextRepository implements ILowRatingContextRepository {
  constructor(private readonly database: Knex) {}

  buildUserQuery(owner: number): Knex.QueryBuilder {
    return this.database('users')
      .where({ id: owner })
      .select('id', 'email', 'patreon')
      .first();
  }

  buildActiveSubscriptionQuery(email: string): Knex.QueryBuilder {
    return this.database('subscriptions')
      .where({ active: true })
      .andWhere((builder) =>
        builder
          .whereRaw('LOWER(linked_email) = LOWER(?)', [email])
          .orWhereRaw('LOWER(email) = LOWER(?)', [email])
      )
      .first();
  }

  buildLatestJobQuery(owner: string): Knex.QueryBuilder {
    return this.database('jobs')
      .where({ owner })
      .orderBy('id', 'desc')
      .select('id', 'status')
      .first();
  }

  async getByOwner(owner: number): Promise<LowRatingAccountContext | null> {
    const user = await this.buildUserQuery(owner);
    if (user == null) {
      return null;
    }

    const activeSubscription = await this.buildActiveSubscriptionQuery(
      user.email
    );
    const latestJob = await this.buildLatestJobQuery(String(user.id));

    return {
      email: user.email,
      userId: String(user.id),
      latestJobId: latestJob == null ? null : Number(latestJob.id),
      latestJobStatus: latestJob?.status ?? null,
      plan: resolvePlan(user.patreon === true, activeSubscription != null),
    };
  }
}

const resolvePlan = (
  isLifetime: boolean,
  hasActiveSubscription: boolean
): FeedbackPlan => {
  if (isLifetime) return 'lifetime';
  if (hasActiveSubscription) return 'subscriber';
  return 'free';
};
