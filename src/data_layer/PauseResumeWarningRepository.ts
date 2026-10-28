import type { Knex } from 'knex';

export interface PausedSubscriptionRow {
  email: string;
  linked_email: string | null;
  payload: unknown;
}

export interface IPauseResumeWarningRepository {
  findPausedResumingBetween(
    fromEpochSeconds: number,
    toEpochSeconds: number
  ): Promise<PausedSubscriptionRow[]>;
  claimNotice(subscriptionEmail: string, resumesAt: Date): Promise<boolean>;
  releaseNotice(subscriptionEmail: string, resumesAt: Date): Promise<void>;
}

export class PauseResumeWarningRepository implements IPauseResumeWarningRepository {
  constructor(private readonly database: Knex) {}

  buildPausedResumingQuery(
    fromEpochSeconds: number,
    toEpochSeconds: number
  ): Knex.QueryBuilder {
    return this.database('subscriptions')
      .select('email', 'linked_email', 'payload')
      .whereRaw(
        "(payload::jsonb #>> '{pause_collection,resumes_at}')::bigint between ? and ?",
        [fromEpochSeconds, toEpochSeconds]
      );
  }

  async findPausedResumingBetween(
    fromEpochSeconds: number,
    toEpochSeconds: number
  ): Promise<PausedSubscriptionRow[]> {
    return (await this.buildPausedResumingQuery(
      fromEpochSeconds,
      toEpochSeconds
    )) as PausedSubscriptionRow[];
  }

  buildClaimNoticeQuery(
    subscriptionEmail: string,
    resumesAt: Date
  ): Knex.QueryBuilder {
    return this.database('pause_resume_warning_notices')
      .insert({
        subscription_email: subscriptionEmail,
        resumes_at: resumesAt,
      })
      .onConflict(['subscription_email', 'resumes_at'])
      .ignore()
      .returning('id');
  }

  async claimNotice(
    subscriptionEmail: string,
    resumesAt: Date
  ): Promise<boolean> {
    const rows = await this.buildClaimNoticeQuery(subscriptionEmail, resumesAt);
    return rows.length > 0;
  }

  buildReleaseNoticeQuery(
    subscriptionEmail: string,
    resumesAt: Date
  ): Knex.QueryBuilder {
    return this.database('pause_resume_warning_notices')
      .where({ subscription_email: subscriptionEmail, resumes_at: resumesAt })
      .del();
  }

  async releaseNotice(
    subscriptionEmail: string,
    resumesAt: Date
  ): Promise<void> {
    await this.buildReleaseNoticeQuery(subscriptionEmail, resumesAt);
  }
}

export default PauseResumeWarningRepository;
