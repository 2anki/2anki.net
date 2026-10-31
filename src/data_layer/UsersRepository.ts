import { Knex } from 'knex';
import type { AdClickAttribution } from '../lib/attribution/adClick';

import Users from './public/Users';
import Subscriptions from './public/Subscriptions';
import { isNewMonth } from '../lib/User/isNewMonth';
import { startOfMonthUtc } from '../lib/User/startOfMonthUtc';
import DeletedUserUsageRepository from './DeletedUserUsageRepository';
import { emailHash } from '../lib/emailHash';
import type { SignupCountryCount } from '../types/ops/BusinessMetrics';

export type { SignupCountryCount };

// Matches the magic-link window in MagicTokenRepository.
export const RESET_TOKEN_TTL_MS = 15 * 60 * 1000;

export type EmailChangeResult =
  | { ok: true }
  | { ok: false; reason: 'invalid_token' | 'email_taken' };

class EmailAlreadyInUseError extends Error {}
class EmailChangeTokenInvalidError extends Error {}

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

const CLEARED_RESET_TOKEN = {
  reset_token: null,
  reset_token_expires_at: null,
};

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

  async getCardOptions(id: string | number): Promise<unknown> {
    const row = await this.database(this.table)
      .select('card_options')
      .where({ id })
      .first();
    return row?.card_options ?? null;
  }

  async getEmailById(id: string | number): Promise<string | undefined> {
    const row = await this.database(this.table)
      .where({ id })
      .returning(['email'])
      .first();
    return row?.email;
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
    signupAttribution?: AdClickAttribution | null,
    now: Date = new Date()
  ): Promise<Array<{ id: string | number }>> {
    return this.database.transaction(async (trx) => {
      const inserted = await trx(this.table)
        .insert({
          name,
          password,
          email,
          signup_origin: signupOrigin ?? null,
          signup_attribution:
            signupAttribution == null
              ? null
              : JSON.stringify(signupAttribution),
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
      'emoji_feedback',
    ];
    // Email-log tables key on the raw address, not the user id; hashed tables
    // (suppression_events, deleted_user_usage, claim audit hashes) are
    // pseudonymized on purpose and stay. emoji_feedback carries both an owner
    // (when the rater was signed in) and the address they left, so it is purged
    // by owner above and by email here.
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
        // linked back to this same user. A warning notice is keyed on the
        // address the warning went to, which for every row this user owns is
        // the account address. Older notices were keyed on the payer; a payer
        // address can now be another account's recipient key, so those are
        // only purged once their resume date has passed and no warning hangs
        // on them.
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
        await this.deletePauseNoticesForAccountQuery(
          trx,
          normalized,
          ownedSubscriptionEmails,
          new Date()
        );
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

  deletePauseNoticesForAccountQuery(
    executor: Knex | Knex.Transaction,
    normalizedEmail: string,
    ownedSubscriptionEmails: Knex.QueryBuilder,
    now: Date
  ) {
    return executor('pause_resume_warning_notices')
      .whereRaw('lower(subscription_email) = ?', [normalizedEmail])
      .orWhere((legacy) =>
        legacy
          .whereIn('subscription_email', ownedSubscriptionEmails)
          .where('resumes_at', '<', now)
      )
      .del();
  }

  // A warning notice is keyed on the address it went to. Once no subscription
  // sends to an address any more, its notice dedupes nothing and would outlive
  // a later account deletion, which only knows the new address. Both email
  // changes relink every row sending to the old address first, so its notice
  // goes; a notice on the address of an account the user only pays for stays.
  forgetPauseNoticesForAddressQuery(
    executor: Knex | Knex.Transaction,
    address: string
  ) {
    const normalized = address.trim().toLowerCase();
    return executor('pause_resume_warning_notices')
      .whereRaw('lower(subscription_email) = ?', [normalized])
      .whereNotExists(
        executor('subscriptions')
          .select(executor.raw('1'))
          .whereRaw('lower(coalesce(linked_email, email)) = ?', [normalized])
      )
      .del();
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

  changeEmailAndRelinkSubscriptions(
    currentEmail: string,
    newEmail: string
  ): Promise<void> {
    const current = currentEmail.trim();
    const next = newEmail.trim().toLowerCase();
    return this.database.transaction(async (trx) => {
      const updated: Array<{ id: number }> = await trx(this.table)
        .whereRaw('LOWER(TRIM(email)) = LOWER(?)', [current])
        .update({ email: next, ...CLEARED_RESET_TOKEN })
        .returning('id');
      const ownerIds = updated.map((row) => row.id);
      await this.spendUnusedMagicTokensQuery(trx, ownerIds);
      await trx('email_change_tokens')
        .whereIn('user_id', ownerIds)
        .whereNull('consumed_at')
        .update({ consumed_at: trx.fn.now() });
      await this.relinkSubscriptionsForEmailChange(trx, current, next);
      await this.forgetPauseNoticesForAddressQuery(trx, current);
    });
  }

  // Links already mailed to the old address must not outlive the address.
  spendUnusedMagicTokensQuery(
    executor: Knex | Knex.Transaction,
    owners: number[]
  ) {
    return executor('magic_tokens')
      .whereIn('owner', owners)
      .whereNull('used_at')
      .update({ used_at: executor.fn.now() });
  }

  // Each side keeps its own column: a payer moving moves subscriptions.email,
  // the address the Stripe customer now carries too, so webhooks keep
  // upserting onto this row; a recipient moving moves linked_email. A row the
  // user both pays for and receives moves on both.
  movePayerSubscriptionsQuery(
    executor: Knex | Knex.Transaction,
    oldEmail: string,
    newEmail: string
  ) {
    return executor('subscriptions')
      .whereRaw('lower(email) = ?', [oldEmail.trim().toLowerCase()])
      .update({ email: newEmail.trim().toLowerCase() });
  }

  moveRecipientSubscriptionsQuery(
    executor: Knex | Knex.Transaction,
    oldEmail: string,
    newEmail: string
  ) {
    return executor('subscriptions')
      .whereRaw('lower(linked_email) = ?', [oldEmail.trim().toLowerCase()])
      .update({ linked_email: newEmail.trim().toLowerCase() });
  }

  async relinkSubscriptionsForEmailChange(
    executor: Knex | Knex.Transaction,
    oldEmail: string,
    newEmail: string
  ): Promise<void> {
    await this.movePayerSubscriptionsQuery(executor, oldEmail, newEmail);
    await this.moveRecipientSubscriptionsQuery(executor, oldEmail, newEmail);
  }

  subscriptionAddressTakenQuery(email: string) {
    const normalized = email.trim().toLowerCase();
    return this.database('subscriptions')
      .whereRaw('lower(email) = ?', [normalized])
      .orWhereRaw('lower(linked_email) = ?', [normalized])
      .select('id')
      .first();
  }

  async subscriptionAddressTaken(email: string): Promise<boolean> {
    return (await this.subscriptionAddressTakenQuery(email)) != null;
  }

  payerCustomerIdsQuery(payerEmail: string) {
    return this.database('subscriptions')
      .whereRaw('lower(email) = ?', [payerEmail.trim().toLowerCase()])
      .select(this.database.raw("payload->>'customer' as customer"));
  }

  // The Stripe customers whose email has to follow a payer's email change: the
  // account's own customer first, then the customer behind each row it pays
  // for. A user who pays for nothing has none, so a recipient-only change never
  // reaches Stripe.
  async payerBilling(
    userId: number,
    payerEmail: string
  ): Promise<{ isPayer: boolean; stripeCustomerIds: string[] }> {
    const rows: Array<{ customer: string | null }> =
      await this.payerCustomerIdsQuery(payerEmail);
    if (rows.length === 0) {
      return { isPayer: false, stripeCustomerIds: [] };
    }
    const user = await this.database(this.table)
      .where({ id: userId })
      .select('stripe_customer_id')
      .first();
    const ids = [
      user?.stripe_customer_id,
      ...rows.map((row) => row.customer),
    ].filter(
      (id): id is string => typeof id === 'string' && id.trim().length > 0
    );
    return { isPayer: true, stripeCustomerIds: [...new Set(ids)] };
  }

  async applyEmailChange(params: {
    userId: number;
    newEmail: string;
    tokenId: number;
    now?: Date;
  }): Promise<EmailChangeResult> {
    const now = params.now ?? new Date();
    const nextEmail = params.newEmail.trim().toLowerCase();
    try {
      await this.database.transaction(async (trx) => {
        const user = await trx(this.table)
          .where({ id: params.userId })
          .forUpdate()
          .first();
        if (user == null) {
          throw new EmailChangeTokenInvalidError();
        }

        const token = await trx('email_change_tokens')
          .where({ id: params.tokenId })
          .forUpdate()
          .first();
        if (
          token == null ||
          token.consumed_at != null ||
          new Date(token.expires_at).getTime() < now.getTime()
        ) {
          throw new EmailChangeTokenInvalidError();
        }

        const collision = await trx(this.table)
          .whereRaw('LOWER(TRIM(email)) = ?', [nextEmail])
          .whereNot({ id: params.userId })
          .first();
        if (collision != null) {
          throw new EmailAlreadyInUseError();
        }

        const oldEmail = String(user.email).trim().toLowerCase();
        await trx(this.table)
          .where({ id: params.userId })
          .update({ email: nextEmail, ...CLEARED_RESET_TOKEN });
        await this.spendUnusedMagicTokensQuery(trx, [params.userId]);
        await this.relinkSubscriptionsForEmailChange(
          trx,
          oldEmail,
          nextEmail
        );
        await this.forgetPauseNoticesForAddressQuery(trx, oldEmail);
        await trx('email_change_tokens')
          .where({ user_id: params.userId })
          .whereNull('consumed_at')
          .update({ consumed_at: trx.fn.now() });
      });
    } catch (error) {
      if (error instanceof EmailAlreadyInUseError) {
        return { ok: false, reason: 'email_taken' };
      }
      if (error instanceof EmailChangeTokenInvalidError) {
        return { ok: false, reason: 'invalid_token' };
      }
      if ((error as { code?: string }).code === '23505') {
        return { ok: false, reason: 'email_taken' };
      }
      throw error;
    }
    return { ok: true };
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

  async claimStripeCustomerId(
    id: string | number,
    candidateId: string
  ): Promise<string> {
    await this.database(this.table)
      .where({ id })
      .whereNull('stripe_customer_id')
      .update({ stripe_customer_id: candidateId });
    const current = await this.getStripeCustomerId(id);
    return current ?? candidateId;
  }

  async clearStripeCustomerIdIf(
    id: string | number,
    oldValue: string
  ): Promise<void> {
    await this.database(this.table)
      .where({ id, stripe_customer_id: oldValue })
      .update({ stripe_customer_id: null });
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
