import type { Knex } from 'knex';

export interface ExpiredPassBuyer {
  id: number;
  name: string;
  email: string;
}

export interface IPassWinbackRepository {
  getExpiredPassBuyers(
    campaign: string,
    limit?: number
  ): Promise<ExpiredPassBuyer[]>;
  claimNotification(
    userId: number,
    campaign: string,
    token: string
  ): Promise<boolean>;
  findByToken(token: string): Promise<{ id: number; userId: number } | null>;
}

interface UserRow {
  id: number;
  name: string;
  email: string;
}

interface NotificationRow {
  id: number;
  user_id: number;
}

const PAID_PASS_KINDS = ['24h', '7d', '120d'];

export class PassWinbackRepository implements IPassWinbackRepository {
  private readonly table = 'pass_winback_notifications';

  constructor(private readonly database: Knex) {}

  buildExpiredPassBuyersQuery(campaign: string, limit: number) {
    return this.database<UserRow>('users')
      .select('users.id', 'users.name', 'users.email')
      .whereRaw('users.patreon IS NOT TRUE')
      .whereExists(
        this.database('user_passes')
          .whereRaw('user_passes.user_id = users.id')
          .whereIn('user_passes.kind', PAID_PASS_KINDS)
          .limit(1)
      )
      .whereNotExists(
        this.database('user_passes')
          .whereRaw('user_passes.user_id = users.id')
          .whereRaw('user_passes.expires_at > now()')
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
        this.database(this.table)
          .whereRaw(`${this.table}.user_id = users.id`)
          .where(`${this.table}.campaign`, campaign)
          .limit(1)
      )
      .orderBy('users.id', 'asc')
      .limit(limit);
  }

  async getExpiredPassBuyers(
    campaign: string,
    limit = 500
  ): Promise<ExpiredPassBuyer[]> {
    const rows = await this.buildExpiredPassBuyersQuery(campaign, limit);
    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      email: row.email,
    }));
  }

  async claimNotification(
    userId: number,
    campaign: string,
    token: string
  ): Promise<boolean> {
    const rows = await this.database(this.table)
      .insert({ user_id: userId, campaign, token })
      .onConflict(['user_id', 'campaign'])
      .ignore()
      .returning('id');
    return rows.length > 0;
  }

  async findByToken(
    token: string
  ): Promise<{ id: number; userId: number } | null> {
    const row = await this.database<NotificationRow>(this.table)
      .select('id', 'user_id')
      .where('token', token)
      .first();
    if (row == null) {
      return null;
    }
    return { id: row.id, userId: row.user_id };
  }
}

export class InMemoryPassWinbackRepository implements IPassWinbackRepository {
  private buyers: ExpiredPassBuyer[] = [];
  private readonly claims: Array<{
    id: number;
    userId: number;
    campaign: string;
    token: string;
  }> = [];
  private nextId = 1;

  seedBuyers(buyers: ExpiredPassBuyer[]): void {
    this.buyers = buyers;
  }

  seedClaim(userId: number, campaign: string, token: string): void {
    this.claims.push({ id: this.nextId++, userId, campaign, token });
  }

  async getExpiredPassBuyers(
    campaign: string,
    limit = 500
  ): Promise<ExpiredPassBuyer[]> {
    return this.buyers
      .filter(
        (buyer) =>
          !this.claims.some(
            (claim) => claim.userId === buyer.id && claim.campaign === campaign
          )
      )
      .slice(0, limit);
  }

  async claimNotification(
    userId: number,
    campaign: string,
    token: string
  ): Promise<boolean> {
    const alreadyClaimed = this.claims.some(
      (claim) => claim.userId === userId && claim.campaign === campaign
    );
    if (alreadyClaimed) {
      return false;
    }
    this.claims.push({ id: this.nextId++, userId, campaign, token });
    return true;
  }

  async findByToken(
    token: string
  ): Promise<{ id: number; userId: number } | null> {
    const found = this.claims.find((claim) => claim.token === token);
    if (found == null) {
      return null;
    }
    return { id: found.id, userId: found.userId };
  }

  getClaims(): ReadonlyArray<{ userId: number; campaign: string }> {
    return this.claims.map((claim) => ({
      userId: claim.userId,
      campaign: claim.campaign,
    }));
  }

  clear(): void {
    this.buyers = [];
    this.claims.length = 0;
    this.nextId = 1;
  }
}

export default PassWinbackRepository;
