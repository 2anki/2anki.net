import type { Knex } from 'knex';

export const INACTIVITY_DELETION_GRACE_DAYS = 14;

export const INACTIVITY_WINDOW = '6 months';

export interface IInactivityEmailRepository {
  getUsersToNotify(
    limit?: number
  ): Promise<Array<{ id: number; name: string; email: string }>>;
  getUsersToDelete(
    limit?: number
  ): Promise<Array<{ id: number; email: string }>>;
  getDeadAddressCandidates(
    limit?: number
  ): Promise<Array<{ id: number; email: string }>>;
  recordSend(userId: number, token: string): Promise<void>;
  findByToken(token: string): Promise<{ id: number; userId: number } | null>;
}

interface UserRow {
  id: number;
  name: string;
  email: string;
}

interface InactivityEmailRow {
  id: number;
  user_id: number;
}

export class InactivityEmailRepository implements IInactivityEmailRepository {
  private readonly table = 'inactivity_emails';

  constructor(private readonly database: Knex) {}

  buildUsersToNotifyQuery(limit: number) {
    return this.database<UserRow>('users')
      .select('users.id', 'users.name', 'users.email')
      .where(function () {
        this.whereRaw(
          `users.last_login_at < now() - interval '${INACTIVITY_WINDOW}'`
        ).orWhereRaw(
          `users.last_login_at IS NULL AND users.created_at < now() - interval '${INACTIVITY_WINDOW}'`
        );
      })
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
        this.buildActivePassExistsQuery('user_passes.user_id = users.id')
      )
      .whereNotExists(
        this.buildActiveDeveloperSubscriptionQuery(
          '(subscriptions_developer.user_id = users.id OR subscriptions_developer.email = users.email)'
        )
      )
      .whereNotExists(
        this.database(this.table)
          .whereRaw('inactivity_emails.user_id = users.id')
          .limit(1)
      )
      .whereNotExists(
        this.database('email_preferences')
          .whereRaw('email_preferences.user_id = users.id')
          .where('email_preferences.marketing_opt_out', true)
          .limit(1)
      )
      .limit(limit);
  }

  async getUsersToNotify(
    limit = 500
  ): Promise<Array<{ id: number; name: string; email: string }>> {
    const rows = await this.buildUsersToNotifyQuery(limit);

    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      email: row.email,
    }));
  }

  buildUsersToDeleteQuery(limit: number) {
    return this.database<UserRow>(`${this.table} as ie`)
      .join('users as u', 'u.id', 'ie.user_id')
      .select('u.id', 'u.email')
      .whereRaw("ie.sent_at < now() - (? || ' days')::interval", [
        INACTIVITY_DELETION_GRACE_DAYS,
      ])
      .where(function () {
        this.whereNull('u.last_login_at').orWhereRaw(
          'u.last_login_at < ie.sent_at'
        );
      })
      .whereRaw('u.patreon IS NOT TRUE')
      .whereNotExists(
        this.database('subscriptions')
          .where('subscriptions.active', true)
          .whereRaw(
            '(subscriptions.email = u.email OR subscriptions.linked_email = u.email)'
          )
          .limit(1)
      )
      .whereNotExists(
        this.buildActivePassExistsQuery('user_passes.user_id = u.id')
      )
      .whereNotExists(
        this.buildActiveDeveloperSubscriptionQuery(
          '(subscriptions_developer.user_id = u.id OR subscriptions_developer.email = u.email)'
        )
      )
      .orderBy('ie.sent_at', 'asc')
      .limit(limit);
  }

  async getUsersToDelete(
    limit = 100
  ): Promise<Array<{ id: number; email: string }>> {
    const rows = await this.buildUsersToDeleteQuery(limit);

    return rows.map((row) => ({ id: row.id, email: row.email }));
  }

  buildDeadAddressCandidatesQuery(limit: number) {
    return this.database<UserRow>('users as u')
      .select('u.id', 'u.email')
      .where(function () {
        this.whereRaw(
          `u.last_login_at < now() - interval '${INACTIVITY_WINDOW}'`
        ).orWhereRaw(
          `u.last_login_at IS NULL AND u.created_at < now() - interval '${INACTIVITY_WINDOW}'`
        );
      })
      .whereRaw('u.patreon IS NOT TRUE')
      .whereNotExists(
        this.database('subscriptions')
          .where('subscriptions.active', true)
          .whereRaw(
            '(subscriptions.email = u.email OR subscriptions.linked_email = u.email)'
          )
          .limit(1)
      )
      .whereNotExists(
        this.buildActivePassExistsQuery('user_passes.user_id = u.id')
      )
      .whereNotExists(
        this.buildActiveDeveloperSubscriptionQuery(
          '(subscriptions_developer.user_id = u.id OR subscriptions_developer.email = u.email)'
        )
      )
      .orderBy('u.id', 'asc')
      .limit(limit);
  }

  // Developer tiers live in subscriptions_developer (#3902), not subscriptions,
  // so a customer whose only paid subscription is a developer tier has no row
  // in the table these guards read. Without this they are treated as a free
  // inactive user: warned, then deleted. Matching on email as well as user_id
  // is deliberate and safe here — this predicate only ever SPARES a user, so a
  // loose match costs nothing, unlike the tier-granting path where an email
  // match would have been a privilege escalation.
  private buildActiveDeveloperSubscriptionQuery(userCorrelation: string) {
    return this.database('subscriptions_developer')
      .where('subscriptions_developer.active', true)
      .whereRaw(userCorrelation)
      .limit(1);
  }

  private buildActivePassExistsQuery(userCorrelation: string) {
    return this.database('user_passes')
      .whereRaw(userCorrelation)
      .whereRaw('user_passes.expires_at > now()')
      .limit(1);
  }

  async getDeadAddressCandidates(
    limit = 100
  ): Promise<Array<{ id: number; email: string }>> {
    const rows = await this.buildDeadAddressCandidatesQuery(limit);
    return rows.map((row) => ({ id: row.id, email: row.email }));
  }

  async recordSend(userId: number, token: string): Promise<void> {
    await this.database(this.table).insert({ user_id: userId, token });
  }

  async findByToken(
    token: string
  ): Promise<{ id: number; userId: number } | null> {
    const row = await this.database<InactivityEmailRow>(this.table)
      .select('id', 'user_id')
      .where('token', token)
      .first();
    if (row == null) {
      return null;
    }
    return { id: row.id, userId: row.user_id };
  }
}

export class InMemoryInactivityEmailRepository implements IInactivityEmailRepository {
  private usersToReturn: Array<{ id: number; name: string; email: string }> =
    [];
  private usersToDelete: Array<{ id: number; email: string }> = [];
  private deadAddressCandidates: Array<{ id: number; email: string }> = [];
  private readonly sentUserIds = new Set<number>();
  private emails: Array<{ id: number; userId: number; token: string }> = [];
  private nextId = 1;

  seedUsers(users: Array<{ id: number; name: string; email: string }>): void {
    this.usersToReturn = users;
  }

  seedUsersToDelete(users: Array<{ id: number; email: string }>): void {
    this.usersToDelete = users;
  }

  seedDeadAddressCandidates(users: Array<{ id: number; email: string }>): void {
    this.deadAddressCandidates = users;
  }

  async getUsersToNotify(
    limit = 500
  ): Promise<Array<{ id: number; name: string; email: string }>> {
    return this.usersToReturn
      .filter((u) => !this.sentUserIds.has(u.id))
      .slice(0, limit);
  }

  async getUsersToDelete(
    limit = 100
  ): Promise<Array<{ id: number; email: string }>> {
    return this.usersToDelete.slice(0, limit);
  }

  async getDeadAddressCandidates(
    limit = 100
  ): Promise<Array<{ id: number; email: string }>> {
    return this.deadAddressCandidates.slice(0, limit);
  }

  async recordSend(userId: number, token: string): Promise<void> {
    const id = this.nextId++;
    this.emails.push({ id, userId, token });
    this.sentUserIds.add(userId);
  }

  async findByToken(
    token: string
  ): Promise<{ id: number; userId: number } | null> {
    const found = this.emails.find((e) => e.token === token);
    if (found == null) {
      return null;
    }
    return { id: found.id, userId: found.userId };
  }

  getSentUserIds(): ReadonlySet<number> {
    return this.sentUserIds;
  }

  clear(): void {
    this.usersToReturn = [];
    this.usersToDelete = [];
    this.deadAddressCandidates = [];
    this.sentUserIds.clear();
    this.emails = [];
    this.nextId = 1;
  }
}

export default InactivityEmailRepository;
