import type { Knex } from 'knex';

import UserPassRepository, {
  IUserPassRepository,
  UserPass,
} from './UserPassRepository';

export interface LowRatingAccountContext {
  email: string;
  userId: string;
  isLifetime: boolean;
  hasActiveSubscription: boolean;
  activePass: UserPass | null;
  latestJobId: number | null;
  latestJobStatus: string | null;
  latestUploadId: number | null;
  latestUploadAt: Date | null;
}

export interface ILowRatingContextRepository {
  getByOwner(owner: number, now: Date): Promise<LowRatingAccountContext | null>;
}

export class LowRatingContextRepository implements ILowRatingContextRepository {
  constructor(
    private readonly database: Knex,
    private readonly passes: Pick<
      IUserPassRepository,
      'findActive'
    > = new UserPassRepository(database)
  ) {}

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

  buildLatestUploadQuery(owner: number): Knex.QueryBuilder {
    return this.database('uploads')
      .where({ owner })
      .orderBy('id', 'desc')
      .select('id', 'created_at')
      .first();
  }

  async getByOwner(
    owner: number,
    now: Date
  ): Promise<LowRatingAccountContext | null> {
    const user = await this.buildUserQuery(owner);
    if (user == null) {
      return null;
    }

    const activeSubscription = await this.buildActiveSubscriptionQuery(
      user.email
    );
    const activePass = await this.passes.findActive(owner, now);
    const latestJob = await this.buildLatestJobQuery(String(user.id));
    const latestUpload = await this.buildLatestUploadQuery(owner);

    return {
      email: user.email,
      userId: String(user.id),
      isLifetime: user.patreon === true,
      hasActiveSubscription: activeSubscription != null,
      activePass,
      latestJobId: latestJob == null ? null : Number(latestJob.id),
      latestJobStatus: latestJob?.status ?? null,
      latestUploadId: latestUpload == null ? null : Number(latestUpload.id),
      latestUploadAt:
        latestUpload?.created_at == null
          ? null
          : new Date(latestUpload.created_at),
    };
  }
}
