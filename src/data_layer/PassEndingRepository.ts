import type { Knex } from 'knex';

import { SEMESTER_RENEWAL_WINDOW_HOURS } from '../lib/passes/semesterRenewal';
import type { PassKind } from './UserPassRepository';

export interface EndingPass {
  passId: number;
  userId: number;
  email: string;
  kind: PassKind;
  expiresAt: Date;
}

export type PassEmailCampaign = 'pass_ending' | 'pass_renewal';

export interface IPassEndingRepository {
  getPassesEndingSoon(
    windowHours: number,
    limit?: number
  ): Promise<EndingPass[]>;
  getSemesterPassesUpForRenewal(limit?: number): Promise<EndingPass[]>;
  claimNotification(
    userId: number,
    passId: number,
    token: string,
    campaign: PassEmailCampaign
  ): Promise<boolean>;
}

interface EndingPassRow {
  pass_id: number;
  user_id: number;
  email: string;
  kind: string;
  expires_at: Date | string;
}

interface EndingPassAudience {
  campaign: PassEmailCampaign;
  kinds: readonly PassKind[];
  fromHours: number;
  toHours: number;
}

// Day Passes are bought the day they are used, so a "ends tomorrow" note
// would arrive at purchase time. Only the passes that run for a while get one.
const NOTIFIED_PASS_KINDS: readonly PassKind[] = ['7d', '120d'];

const SEMESTER_RENEWAL_AUDIENCE: EndingPassAudience = {
  campaign: 'pass_renewal',
  kinds: ['120d'],
  fromHours: 24,
  toHours: SEMESTER_RENEWAL_WINDOW_HOURS,
};

export function passEmailCampaign(
  campaign: PassEmailCampaign,
  passId: number
): string {
  return `${campaign}:${passId}`;
}

export function passEndingCampaign(passId: number): string {
  return passEmailCampaign('pass_ending', passId);
}

/**
 * Reads the passes about to expire and records who was told. Sends are
 * recorded in pass_winback_notifications under a per-pass campaign so the
 * /r/email click redirect resolves the token the same way as the win-back.
 */
export class PassEndingRepository implements IPassEndingRepository {
  private readonly notificationsTable = 'pass_winback_notifications';

  constructor(private readonly database: Knex) {}

  private buildAudienceQuery(audience: EndingPassAudience, limit: number) {
    return this.database<EndingPassRow>('user_passes')
      .join('users', 'users.id', 'user_passes.user_id')
      .select(
        'user_passes.id as pass_id',
        'user_passes.user_id',
        'users.email',
        'user_passes.kind',
        'user_passes.expires_at'
      )
      .whereIn('user_passes.kind', audience.kinds)
      .whereRaw('user_passes.expires_at > now() + make_interval(hours => ?)', [
        audience.fromHours,
      ])
      .whereRaw('user_passes.expires_at <= now() + make_interval(hours => ?)', [
        audience.toHours,
      ])
      .whereRaw('users.patreon IS NOT TRUE')
      .whereNotExists(
        this.database('user_passes as later_passes')
          .whereRaw('later_passes.user_id = user_passes.user_id')
          .whereRaw('later_passes.expires_at > user_passes.expires_at')
          .limit(1)
      )
      .whereNotExists(
        this.database('subscriptions')
          .where('subscriptions.active', true)
          .whereRaw(
            '(subscriptions.email = users.email OR subscriptions.linked_email = users.email)'
          )
          .limit(1)
      )
      .whereNotExists(
        this.database('email_preferences')
          .whereRaw('email_preferences.user_id = users.id')
          .where('email_preferences.marketing_opt_out', true)
          .limit(1)
      )
      .whereNotExists(
        this.database(this.notificationsTable)
          .whereRaw(`${this.notificationsTable}.user_id = users.id`)
          .whereRaw(
            `${this.notificationsTable}.campaign = ? || user_passes.id::text`,
            [`${audience.campaign}:`]
          )
          .limit(1)
      )
      .orderBy('user_passes.expires_at', 'asc')
      .limit(limit);
  }

  buildPassesEndingSoonQuery(windowHours: number, limit: number) {
    return this.buildAudienceQuery(
      {
        campaign: 'pass_ending',
        kinds: NOTIFIED_PASS_KINDS,
        fromHours: 0,
        toHours: windowHours,
      },
      limit
    );
  }

  buildSemesterPassesUpForRenewalQuery(limit: number) {
    return this.buildAudienceQuery(
      SEMESTER_RENEWAL_AUDIENCE,
      limit
    ).whereNotExists(
      this.database('user_passes as other_passes')
        .whereRaw('other_passes.user_id = user_passes.user_id')
        .whereRaw('other_passes.expires_at > now()')
        .whereRaw("other_passes.kind <> '120d'")
        .limit(1)
    );
  }

  private static toEndingPass(row: EndingPassRow): EndingPass {
    return {
      passId: row.pass_id,
      userId: row.user_id,
      email: row.email,
      kind: row.kind as PassKind,
      expiresAt:
        row.expires_at instanceof Date
          ? row.expires_at
          : new Date(row.expires_at),
    };
  }

  async getPassesEndingSoon(
    windowHours: number,
    limit = 200
  ): Promise<EndingPass[]> {
    const rows = await this.buildPassesEndingSoonQuery(windowHours, limit);
    return rows.map(PassEndingRepository.toEndingPass);
  }

  async getSemesterPassesUpForRenewal(limit = 200): Promise<EndingPass[]> {
    const rows = await this.buildSemesterPassesUpForRenewalQuery(limit);
    return rows.map(PassEndingRepository.toEndingPass);
  }

  async claimNotification(
    userId: number,
    passId: number,
    token: string,
    campaign: PassEmailCampaign
  ): Promise<boolean> {
    const rows = await this.database(this.notificationsTable)
      .insert({
        user_id: userId,
        campaign: passEmailCampaign(campaign, passId),
        token,
      })
      .onConflict(['user_id', 'campaign'])
      .ignore()
      .returning('id');
    return rows.length > 0;
  }
}

export class InMemoryPassEndingRepository implements IPassEndingRepository {
  private passes: EndingPass[] = [];
  private renewalPasses: EndingPass[] = [];
  private readonly claims: Array<{
    userId: number;
    campaign: string;
    token: string;
  }> = [];

  seedPasses(passes: EndingPass[]): void {
    this.passes = passes;
  }

  seedRenewalPasses(passes: EndingPass[]): void {
    this.renewalPasses = passes;
  }

  private unclaimed(
    passes: EndingPass[],
    campaign: PassEmailCampaign,
    limit: number
  ): EndingPass[] {
    return passes
      .filter(
        (pass) =>
          !this.claims.some(
            (claim) =>
              claim.userId === pass.userId &&
              claim.campaign === passEmailCampaign(campaign, pass.passId)
          )
      )
      .slice(0, limit);
  }

  async getPassesEndingSoon(
    _windowHours: number,
    limit = 200
  ): Promise<EndingPass[]> {
    return this.unclaimed(this.passes, 'pass_ending', limit);
  }

  async getSemesterPassesUpForRenewal(limit = 200): Promise<EndingPass[]> {
    return this.unclaimed(this.renewalPasses, 'pass_renewal', limit);
  }

  async claimNotification(
    userId: number,
    passId: number,
    token: string,
    campaign: PassEmailCampaign
  ): Promise<boolean> {
    const key = passEmailCampaign(campaign, passId);
    const alreadyClaimed = this.claims.some(
      (claim) => claim.userId === userId && claim.campaign === key
    );
    if (alreadyClaimed) {
      return false;
    }
    this.claims.push({ userId, campaign: key, token });
    return true;
  }

  getClaims(): ReadonlyArray<{ userId: number; campaign: string }> {
    return this.claims.map((claim) => ({
      userId: claim.userId,
      campaign: claim.campaign,
    }));
  }
}

export default PassEndingRepository;
