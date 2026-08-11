import { Knex } from 'knex';

import Users from './public/Users';
import Subscriptions from './public/Subscriptions';
import { isNewMonth } from '../lib/User/isNewMonth';
import { startOfMonthUtc } from '../lib/User/startOfMonthUtc';
import DeletedUserUsageRepository from './DeletedUserUsageRepository';
import { emailHash } from '../lib/emailHash';

// Matches the magic-link window in MagicTokenRepository.
export const RESET_TOKEN_TTL_MS = 15 * 60 * 1000;

export interface SignupCountryCount {
  country: string;
  count: number;
}

export interface ISignupCountryRepository {
  countBySignupCountry(
    since: Date,
    limit: number
  ): Promise<SignupCountryCount[]>;
}

export interface IUserSignupCountsRepository {
  countTotalUsers(): Promise<number>;
  countSignupsSince(since: Date): Promise<number>;
}

function toDateOrNull(value: Date | string | number | null): Date | null {
  if (value == null) return null;
  return value instanceof Date ? value : new Date(value);
}

class UsersRepository {
  table: string;
  private deletedUserUsage: DeletedUserUsageRepository;

  constructor(
    private database: Knex,
    deletedUserUsage?: DeletedUserUsageRepository
  ) {
    this.database = database;
    this.table = 'users';
    this.deletedUserUsage =
      deletedUserUsage ?? new DeletedUserUsageRepository(database);
  }

  async getById(id: string): Promise<Users> {
    const user = await this.database.table(this.table).where({ id }).first();
    return user;
  }

  async getEmailById(id: string | number): Promise<string | undefined> {
    const row = await this.database(this.table)
      .where({ id })
      .returning(['email'])
      .first();
    return row?.email;
  }

  async getAiTemplateCounts(id: string | number) {
    const row = await this.database
      .table(this.table)
      .where({ id })
      .select('ai_template_generate_count', 'ai_template_modify_count')
      .first();
    return {
      generate: row?.ai_template_generate_count ?? 0,
      modify: row?.ai_template_modify_count ?? 0,
    };
  }

  incrementAiTemplateGenerateCount(id: string | number) {
    return this.database(this.table)
      .where({ id })
      .increment('ai_template_generate_count', 1);
  }

  incrementAiTemplateModifyCount(id: string | number) {
    return this.database(this.table)
      .where({ id })
      .increment('ai_template_modify_count', 1);
  }

  // A reset token is single-use and time-boxed, matching MagicTokenRepository:
  // the same token must never redeem twice, and an abandoned link must stop
  // working rather than staying valid indefinitely.
  buildUpdatePasswordQuery(hashPassword: string, reset_token: string) {
    return this.database(this.table)
      .where({ reset_token })
      .whereNotNull('reset_token_expires_at')
      .where('reset_token_expires_at', '>', this.database.fn.now())
      .whereNull('reset_token_used_at')
      .update({
        password: hashPassword,
        reset_token: null,
        reset_token_used_at: this.database.fn.now(),
      });
  }

  updatePassword(hashPassword: string, reset_token: string) {
    return this.buildUpdatePasswordQuery(hashPassword, reset_token);
  }

  getByResetToken(token: string) {
    return this.database(this.table).where({ reset_token: token }).first();
  }

  getByEmail(email: string) {
    return this.database(this.table)
      .whereRaw('LOWER(TRIM(email)) = LOWER(?)', [email.trim()])
      .first();
  }

  async getLanguageByEmail(email: string): Promise<string | null> {
    const row = await this.database(this.table)
      .whereRaw('LOWER(TRIM(email)) = LOWER(?)', [email.trim()])
      .select('language')
      .first();
    return row?.language ?? null;
  }

  async setDeveloperAccessByEmail(
    email: string,
    value: boolean
  ): Promise<number> {
    return this.database(this.table)
      .whereRaw('LOWER(TRIM(email)) = LOWER(?)', [email.trim()])
      .update({ developer_access: value });
  }

  buildUpdateResetTokenQuery(id: string, resetToken: string, expiresAt: Date) {
    return this.database(this.table).where({ id }).update({
      reset_token: resetToken,
      reset_token_expires_at: expiresAt,
      reset_token_used_at: null,
    });
  }

  updateResetToken(
    id: string,
    resetToken: string,
    expiresAt: Date = new Date(Date.now() + RESET_TOKEN_TTL_MS)
  ) {
    return this.buildUpdateResetTokenQuery(id, resetToken, expiresAt);
  }

  createUser(
    name: string,
    password: string,
    email: string,
    signupOrigin?: string | null
  ) {
    return this.database(this.table)
      .insert({
        name,
        password,
        email,
        signup_origin: signupOrigin ?? null,
      })
      .returning(['id']);
  }

  async createUserAndSeedFromTombstone(
    name: string,
    password: string,
    email: string,
    signupOrigin?: string | null,
    now: Date = new Date()
  ): Promise<Array<{ id: string | number }>> {
    return this.database.transaction(async (trx) => {
      const inserted = await trx(this.table)
        .insert({
          name,
          password,
          email,
          signup_origin: signupOrigin ?? null,
        })
        .returning(['id']);
      const id = inserted[0].id;
      await this.applyTombstoneSeed(id, email, now, trx);
      return inserted;
    });
  }

  private async applyTombstoneSeed(
    id: string | number,
    email: string,
    now: Date,
    trx: Knex.Transaction
  ) {
    const seed = await this.deletedUserUsage.consumeIfCurrentMonth(
      emailHash(email),
      now,
      trx
    );
    if (!seed) return;
    await trx(this.table)
      .where({ id })
      .update({
        cards_used_this_month: seed.cards_used_this_month,
        cards_month_started_at: seed.cards_month_started_at ?? now,
        pdf_prints_this_month: seed.pdf_prints_this_month,
        prints_month_started_at: seed.prints_month_started_at ?? now,
      });
  }

  async deleteUser(owner: string) {
    const ownerTables = [
      'access_tokens',
      'favorites',
      'jobs',
      'notion_tokens',
      'settings',
      'templates',
      'uploads',
      'blocks',
      'dropbox_uploads',
      'google_drive_uploads',
      'cancellation_feedback',
    ];
    // Feedback and email-log tables key on the raw address, not the user id;
    // hashed tables (suppression_events, deleted_user_usage, claim audit
    // hashes) are pseudonymized on purpose and stay.
    const emailTables: Array<[string, string]> = [
      ['feedback', 'email'],
      ['emoji_feedback', 'email'],
      ['abandoned_checkout_recovery_emails', 'user_email'],
    ];
    return this.database.transaction(async (trx) => {
      const email = await this.snapshotUsageForTombstone(owner, trx);
      if (email != null) {
        const normalized = email.toLowerCase();
        for (const [tableName, column] of emailTables) {
          await trx(tableName)
            .whereRaw('lower(??) = ?', [column, normalized])
            .del();
        }
        // subscriptions.email is the Stripe payer, linked_email the account
        // the entitlement was granted to — often different people. Deleting on
        // the payer address alone would revoke a live third party's paid
        // access, so a payer-matched row is only purged when it is unlinked or
        // linked back to this same user. Same reason the warning-notice rows
        // are scoped through the subscription rows this user actually owns.
        const ownedSubscriptionEmails = trx('subscriptions')
          .where((qb) =>
            qb
              .whereRaw('lower(email) = ?', [normalized])
              .whereRaw('(linked_email is null or lower(linked_email) = ?)', [
                normalized,
              ])
          )
          .orWhereRaw('lower(linked_email) = ?', [normalized])
          .select('email');
        await trx('pause_resume_warning_notices')
          .whereIn('subscription_email', ownedSubscriptionEmails)
          .del();
        await trx('subscriptions')
          .where((qb) =>
            qb
              .whereRaw('lower(email) = ?', [normalized])
              .whereRaw('(linked_email is null or lower(linked_email) = ?)', [
                normalized,
              ])
          )
          .orWhereRaw('lower(linked_email) = ?', [normalized])
          .del();
      }
      for (const tableName of ownerTables) {
        await trx(tableName).where({ owner }).del();
      }
      await trx(this.table).where({ id: owner }).del();
    });
  }

  private async snapshotUsageForTombstone(
    owner: string,
    trx: Knex.Transaction
  ): Promise<string | null> {
    const row = await trx(this.table)
      .where({ id: owner })
      .select(
        'email',
        'cards_used_this_month',
        'cards_month_started_at',
        'pdf_prints_this_month',
        'prints_month_started_at'
      )
      .first();
    if (!row?.email) return null;
    await this.deletedUserUsage.snapshot(
      emailHash(row.email),
      {
        cards_used_this_month: row.cards_used_this_month ?? 0,
        cards_month_started_at: row.cards_month_started_at ?? null,
        pdf_prints_this_month: row.pdf_prints_this_month ?? 0,
        prints_month_started_at: row.prints_month_started_at ?? null,
      },
      trx
    );
    return row.email as string;
  }

  async linkCurrentUserWithEmail(owner: string, email: string) {
    const user = await this.database(this.table).where({ id: owner }).first();
    if (!user) {
      return null;
    }

    return this.updateSubScriptionEmailUsingPrimaryEmail(user.email, email);
  }

  updateSubScriptionEmailUsingPrimaryEmail(email: string, newEmail: string) {
    return this.database('subscriptions')
      .where({ email: email.toLowerCase() })
      .update({ linked_email: newEmail.toLowerCase() });
  }

  async getSubscriptionLinkedEmail(owner: string) {
    const user = await this.database(this.table).where({ id: owner }).first();
    if (!user) {
      return null;
    }

    const subscription: Subscriptions = await this.database('subscriptions')
      .where({ email: user.email.toLowerCase() })
      .select('linked_email')
      .first();
    return subscription?.linked_email;
  }

  updateLastLoginAt(id: string) {
    return this.database(this.table).where({ id }).update({
      last_login_at: this.database.fn.now(),
    });
  }

  updateName(id: string | number, name: string) {
    return this.database(this.table).where({ id }).update({ name });
  }

  markHostedAnkiRequested(id: string) {
    return this.database(this.table).where({ id }).update({
      hosted_anki_requested_at: this.database.fn.now(),
    });
  }

  markAnkifyWelcomeSeen(id: string) {
    return this.database(this.table).where({ id }).update({
      ankify_welcome_seen: true,
    });
  }

  markEmailVerified(userId: string) {
    return this.database(this.table)
      .where({ id: userId })
      .update({ email_verified: true });
  }

  updatePatreonByEmail(email: string, patreon: boolean): Promise<number> {
    return this.database(this.table)
      .whereRaw('TRIM(LOWER(email)) = ?', [email.toLowerCase().trim()])
      .update({ patreon });
  }

  async checkSubscriptionEmailExists(email: string): Promise<boolean> {
    const subscription = await this.database('subscriptions')
      .where({ email: email.toLowerCase() })
      .first();
    return !!subscription;
  }

  async getCardUsage(
    id: string | number
  ): Promise<{ cards_used: number; month_started_at: Date | null }> {
    const row = await this.database
      .table(this.table)
      .where({ id })
      .select('cards_used_this_month', 'cards_month_started_at')
      .first();
    if (!row) {
      return { cards_used: 0, month_started_at: null };
    }
    const startedAt = toDateOrNull(row.cards_month_started_at ?? null);
    if (startedAt && isNewMonth(startedAt, new Date())) {
      const monthStart = startOfMonthUtc(new Date());
      await this.database(this.table)
        .where({ id })
        .where('cards_month_started_at', '<', monthStart)
        .update({
          cards_used_this_month: 0,
          cards_month_started_at: monthStart,
        });
      return { cards_used: 0, month_started_at: monthStart };
    }
    return {
      cards_used: row.cards_used_this_month ?? 0,
      month_started_at: startedAt,
    };
  }

  setSignupCountryIfMissing(id: string | number, country: string) {
    return this.database(this.table)
      .where({ id })
      .whereNull('signup_country')
      .update({ signup_country: country });
  }

  setChatConsentAt(userId: number): Promise<void> {
    return this.database(this.table)
      .where({ id: userId })
      .update({ chat_consent_at: this.database.fn.now() })
      .then(() => undefined);
  }

  getSignupCountry(id: string | number): Promise<string | null> {
    return this.database(this.table)
      .where({ id })
      .select('signup_country')
      .first()
      .then(
        (row: { signup_country: string | null } | undefined) =>
          row?.signup_country ?? null
      );
  }

  signupCountryBreakdown(sinceDays: number) {
    return this.database(this.table)
      .whereNotNull('signup_country')
      .where(
        'created_at',
        '>=',
        this.database.raw("NOW() - (? * INTERVAL '1 day')", [sinceDays])
      )
      .select('signup_country')
      .count<{ signup_country: string; count: string }[]>('* as count')
      .groupBy('signup_country')
      .orderBy('count', 'desc');
  }

  async countBySignupCountry(
    since: Date,
    limit: number
  ): Promise<{ country: string; count: number }[]> {
    const rows = (await this.database(this.table)
      .whereNotNull('signup_country')
      .where('created_at', '>=', since)
      .select('signup_country')
      .count<{ signup_country: string; count: string }[]>('* as count')
      .groupBy('signup_country')
      .orderBy('count', 'desc')
      .limit(limit)) as { signup_country: string; count: string }[];
    return rows.map((row) => ({
      country: row.signup_country,
      count: Number(row.count),
    }));
  }

  async getSignupOriginsByIds(
    userIds: number[]
  ): Promise<Map<number, string | null>> {
    if (userIds.length === 0) return new Map();
    const rows = (await this.database(this.table)
      .whereIn('id', userIds)
      .whereNotNull('signup_origin')
      .select('id', 'signup_origin')) as {
      id: number;
      signup_origin: string;
    }[];
    return new Map(rows.map((row) => [Number(row.id), row.signup_origin]));
  }

  markOnboarded(id: string | number) {
    return this.database(this.table)
      .where({ id })
      .whereNull('onboarded_at')
      .update({ onboarded_at: this.database.fn.now() });
  }

  incrementCardUsage(id: string | number, cardCount: number) {
    if (cardCount <= 0) return Promise.resolve(0);
    const monthStart = startOfMonthUtc(new Date());
    return this.database(this.table)
      .where({ id })
      .update({
        cards_used_this_month: this.database.raw(
          `CASE WHEN cards_month_started_at < ? THEN ? ELSE cards_used_this_month + ? END`,
          [monthStart, cardCount, cardCount]
        ),
        cards_month_started_at: this.database.raw(
          `CASE WHEN cards_month_started_at < ? THEN ? ELSE cards_month_started_at END`,
          [monthStart, monthStart]
        ),
      });
  }

  async getPrintUsage(
    id: string | number
  ): Promise<{ prints_used: number; month_started_at: Date | null }> {
    const row = await this.database
      .table(this.table)
      .where({ id })
      .select('pdf_prints_this_month', 'prints_month_started_at')
      .first();
    if (!row) {
      return { prints_used: 0, month_started_at: null };
    }
    const startedAt: Date | null = row.prints_month_started_at ?? null;
    if (startedAt && isNewMonth(startedAt, new Date())) {
      return { prints_used: 0, month_started_at: startedAt };
    }
    return {
      prints_used: row.pdf_prints_this_month ?? 0,
      month_started_at: startedAt,
    };
  }

  incrementPrintUsage(id: string | number) {
    const monthStart = startOfMonthUtc(new Date());
    return this.database(this.table)
      .where({ id })
      .update({
        pdf_prints_this_month: this.database.raw(
          `CASE WHEN prints_month_started_at < ? THEN 1 ELSE pdf_prints_this_month + 1 END`,
          [monthStart]
        ),
        prints_month_started_at: this.database.raw(
          `CASE WHEN prints_month_started_at < ? THEN ? ELSE prints_month_started_at END`,
          [monthStart, monthStart]
        ),
      });
  }

  setStripeCustomerId(
    id: string | number,
    stripeCustomerId: string,
    trx?: Knex.Transaction
  ) {
    const db = trx ?? this.database;
    return db(this.table)
      .where({ id })
      .update({ stripe_customer_id: stripeCustomerId });
  }

  getStripeCustomerId(id: string | number): Promise<string | null> {
    return this.database(this.table)
      .where({ id })
      .select('stripe_customer_id')
      .first()
      .then(
        (row: { stripe_customer_id: string | null } | undefined) =>
          row?.stripe_customer_id ?? null
      );
  }

  async countTotalUsers(): Promise<number> {
    const row = (await this.database(this.table)
      .count<{ count: string | number }>('* as count')
      .first()) as { count: string | number } | undefined;
    return Number(row?.count ?? 0);
  }

  async countSignupsSince(since: Date): Promise<number> {
    const row = (await this.database(this.table)
      .where('created_at', '>=', since)
      .count<{ count: string | number }>('* as count')
      .first()) as { count: string | number } | undefined;
    return Number(row?.count ?? 0);
  }
}

export class InMemoryUserSignupCountsRepository implements IUserSignupCountsRepository {
  private totalUsers = 0;

  private readonly signupDates: Date[] = [];

  setTotalUsers(total: number): void {
    this.totalUsers = total;
  }

  addSignup(createdAt: Date): void {
    this.signupDates.push(createdAt);
  }

  async countTotalUsers(): Promise<number> {
    return this.totalUsers;
  }

  async countSignupsSince(since: Date): Promise<number> {
    return this.signupDates.filter((date) => date >= since).length;
  }
}

export default UsersRepository;
