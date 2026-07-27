import type { Knex } from 'knex';
import hmacToken from '../../lib/misc/hmacToken';
import type { ISubscriptionClaimTokensRepository } from '../../data_layer/SubscriptionClaimTokensRepository';
import type { ISubscriptionClaimAuditRepository } from '../../data_layer/SubscriptionClaimAuditRepository';
import type UsersRepository from '../../data_layer/UsersRepository';
import type { SubscriptionService } from '../../services/SubscriptionService';
import { updateStoreSubscription } from '../../lib/integrations/stripe';
import type { Stripe as StripeTypes } from 'stripe/cjs/stripe.core';

export type ConfirmOutcome =
  | { success: true }
  | {
      success: false;
      reason:
        | 'invalid_token'
        | 'already_consumed'
        | 'user_has_active_sub'
        | 'race';
    };

export class ConfirmSubscriptionClaimUseCase {
  constructor(
    private readonly db: Knex,
    private readonly tokensRepo: ISubscriptionClaimTokensRepository,
    private readonly auditRepo: ISubscriptionClaimAuditRepository,
    private readonly usersRepo: UsersRepository,
    private readonly subscriptionService: typeof SubscriptionService,
    private readonly stripe: StripeTypes
  ) {}

  async execute(
    userId: number,
    rawToken: string,
    ipHash: string,
    emailHash: string
  ): Promise<ConfirmOutcome> {
    const tokenHash = hmacToken(rawToken);
    const tokenRow = await this.tokensRepo.findByTokenHash(tokenHash);

    if (
      tokenRow == null ||
      new Date(tokenRow.expires_at).getTime() < Date.now()
    ) {
      await this.auditRepo.insert({
        user_id: userId,
        email_hash: emailHash,
        ip_hash: ipHash,
        outcome: 'confirm_invalid_token',
      });
      return { success: false, reason: 'invalid_token' };
    }

    if (tokenRow.consumed_at != null) {
      await this.auditRepo.insert({
        user_id: userId,
        email_hash: emailHash,
        ip_hash: ipHash,
        outcome:
          tokenRow.user_id === userId ? 'confirm_already_consumed' : 'replay',
      });
      return { success: false, reason: 'already_consumed' };
    }

    const existingSubs =
      await this.subscriptionService.findActiveStripeSubscriptions(
        await this.getEmailForUser(userId)
      );
    if (existingSubs.length > 0) {
      await this.auditRepo.insert({
        user_id: userId,
        email_hash: emailHash,
        ip_hash: ipHash,
        outcome: 'confirm_user_has_active_sub',
      });
      return { success: false, reason: 'user_has_active_sub' };
    }

    try {
      await this.db.transaction(async (trx) => {
        await trx('users').where({ id: userId }).forUpdate().first();
        await this.tokensRepo.markConsumed(tokenRow.id, trx);
        await trx('users')
          .where({ id: userId })
          .update({ stripe_customer_id: tokenRow.stripe_customer_id });

        const customer = (await this.stripe.customers.retrieve(
          tokenRow.stripe_customer_id,
          {
            expand: ['subscriptions'],
          }
        )) as StripeTypes.Customer;

        const activeSubs =
          customer.subscriptions?.data?.filter((s) => s.status === 'active') ??
          [];
        for (const sub of activeSubs) {
          await updateStoreSubscription(trx, customer, sub);
        }
      });
    } catch (err) {
      const pgErr = err as { code?: string };
      if (pgErr.code === '23505') {
        await this.auditRepo.insert({
          user_id: userId,
          email_hash: emailHash,
          ip_hash: ipHash,
          outcome: 'replay',
        });
        return { success: false, reason: 'race' };
      }
      throw err;
    }

    await this.auditRepo.insert({
      user_id: userId,
      email_hash: emailHash,
      ip_hash: ipHash,
      outcome: 'confirm_success',
    });

    return { success: true };
  }

  private async getEmailForUser(userId: number): Promise<string> {
    const email = await this.usersRepo.getEmailById(userId);
    return email ?? '';
  }
}
