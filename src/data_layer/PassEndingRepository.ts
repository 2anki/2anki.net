import type { Knex } from 'knex';

import type { PassKind } from './UserPassRepository';

export interface EndingPass {
  passId: number;
  userId: number;
  email: string;
  kind: PassKind;
}

export interface IPassEndingRepository {
  getPassesEndingSoon(
    windowHours: number,
    limit?: number
  ): Promise<EndingPass[]>;
  claimNotification(
    userId: number,
    passId: number,
    token: string
  ): Promise<boolean>;
}

interface EndingPassRow {
  pass_id: number;
  user_id: number;
  email: string;
  kind: string;
}

// Day Passes are bought the day they are used, so a "ends tomorrow" note
// would arrive at purchase time. Only the passes that run for a while get one.
const NOTIFIED_PASS_KINDS = ['7d', '120d'];

export function passEndingCampaign(passId: number): string {
  return `pass_ending:${passId}`;
}

/**
 * Reads the passes about to expire and records who was told. Sends are
 * recorded in pass_winback_notifications under a per-pass campaign so the
 * /r/email click redirect resolves the token the same way as the win-back.
 */
export class PassEndingRepository implements IPassEndingRepository {
  private readonly notificationsTable = 'pass_winback_notifications';

  constructor(private readonly database: Knex) {}

  buildPassesEndingSoonQuery(windowHours: number, limit: number) {
    return this.database<EndingPassRow>('user_passes')
      .join('users', 'users.id', 'user_passes.user_id')
      .select(
        'user_passes.id as pass_id',
        'user_passes.user_id',
        'users.email',
        'user_passes.kind'
      )
      .whereIn('user_passes.kind', NOTIFIED_PASS_KINDS)
      .whereRaw('user_passes.expires_at > now()')
      .whereRaw('user_passes.expires_at <= now() + make_interval(hours => ?)', [
        windowHours,
      ])
      .whereRaw('users.patreon IS NOT TRUE')
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
            `${this.notificationsTable}.campaign = 'pass_ending:' || user_passes.id::text`
          )
          .limit(1)
      )
      .orderBy('user_passes.expires_at', 'asc')
      .limit(limit);
  }

  async getPassesEndingSoon(
    windowHours: number,
    limit = 200
  ): Promise<EndingPass[]> {
    const rows = await this.buildPassesEndingSoonQuery(windowHours, limit);
    return rows.map((row) => ({
      passId: row.pass_id,
      userId: row.user_id,
      email: row.email,
      kind: row.kind as PassKind,
    }));
  }

  async claimNotification(
    userId: number,
    passId: number,
    token: string
  ): Promise<boolean> {
    const rows = await this.database(this.notificationsTable)
      .insert({ user_id: userId, campaign: passEndingCampaign(passId), token })
      .onConflict(['user_id', 'campaign'])
      .ignore()
      .returning('id');
    return rows.length > 0;
  }
}

export class InMemoryPassEndingRepository implements IPassEndingRepository {
  private passes: EndingPass[] = [];
  private readonly claims: Array<{
    userId: number;
    campaign: string;
    token: string;
  }> = [];

  seedPasses(passes: EndingPass[]): void {
    this.passes = passes;
  }

  async getPassesEndingSoon(
    _windowHours: number,
    limit = 200
  ): Promise<EndingPass[]> {
    return this.passes
      .filter(
        (pass) =>
          !this.claims.some(
            (claim) =>
              claim.userId === pass.userId &&
              claim.campaign === passEndingCampaign(pass.passId)
          )
      )
      .slice(0, limit);
  }

  async claimNotification(
    userId: number,
    passId: number,
    token: string
  ): Promise<boolean> {
    const campaign = passEndingCampaign(passId);
    const alreadyClaimed = this.claims.some(
      (claim) => claim.userId === userId && claim.campaign === campaign
    );
    if (alreadyClaimed) {
      return false;
    }
    this.claims.push({ userId, campaign, token });
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
