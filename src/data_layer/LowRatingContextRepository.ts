import type { Knex } from 'knex';

export type FeedbackPlan = 'lifetime' | 'subscriber' | 'free' | 'unknown';

export interface LowRatingContext {
  userId: string | null;
  latestJobId: number | null;
  latestJobStatus: string | null;
  plan: FeedbackPlan;
}

export interface ILowRatingContextRepository {
  getByEmail(email: string): Promise<LowRatingContext>;
}

export class LowRatingContextRepository implements ILowRatingContextRepository {
  constructor(private readonly database: Knex) {}

  async getByEmail(email: string): Promise<LowRatingContext> {
    const normalized = email.trim().toLowerCase();

    const user = await this.database('users')
      .whereRaw('LOWER(TRIM(email)) = LOWER(?)', [email.trim()])
      .select('id', 'patreon')
      .first();

    const activeSubscription = await this.database('subscriptions')
      .where({ active: true })
      .andWhere((builder) =>
        builder
          .where({ linked_email: normalized })
          .orWhere({ email: normalized })
      )
      .first();

    const plan = resolvePlan(
      user != null,
      user?.patreon === true,
      activeSubscription != null
    );

    if (user == null) {
      return {
        userId: null,
        latestJobId: null,
        latestJobStatus: null,
        plan,
      };
    }

    const userId = String(user.id);
    const latestJob = await this.database('jobs')
      .where({ owner: userId })
      .orderBy('id', 'desc')
      .select('id', 'status')
      .first();

    return {
      userId,
      latestJobId: latestJob == null ? null : Number(latestJob.id),
      latestJobStatus: latestJob?.status ?? null,
      plan,
    };
  }
}

const resolvePlan = (
  hasUser: boolean,
  isLifetime: boolean,
  hasActiveSubscription: boolean
): FeedbackPlan => {
  if (isLifetime) return 'lifetime';
  if (hasActiveSubscription) return 'subscriber';
  return hasUser ? 'free' : 'unknown';
};
