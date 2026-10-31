import type { IEmailChangeTokenRepository } from '../../data_layer/EmailChangeTokenRepository';
import type UsersRepository from '../../data_layer/UsersRepository';
import type { StripeCustomerEmails } from '../../services/StripeCustomerEmailService';
import hmacToken from '../../lib/misc/hmacToken';
import { moveBillingEmail } from './moveBillingEmail';

export type ConfirmEmailChangeOutcome =
  | { ok: true; userId: number }
  | {
      ok: false;
      reason:
        | 'invalid_token'
        | 'email_taken'
        | 'payer_relay_address'
        | 'billing_update_failed';
    };

export class ConfirmEmailChangeUseCase {
  constructor(
    private readonly tokensRepo: IEmailChangeTokenRepository,
    private readonly usersRepo: UsersRepository,
    private readonly revokeSessions: (userId: number) => Promise<unknown>,
    private readonly stripeCustomers: StripeCustomerEmails
  ) {}

  async execute(rawToken: string): Promise<ConfirmEmailChangeOutcome> {
    const trimmed = rawToken.trim();
    if (trimmed.length === 0) {
      return { ok: false, reason: 'invalid_token' };
    }

    const tokenRow = await this.tokensRepo.findByTokenHash(hmacToken(trimmed));
    if (
      tokenRow == null ||
      tokenRow.consumed_at != null ||
      new Date(tokenRow.expires_at).getTime() < Date.now()
    ) {
      return { ok: false, reason: 'invalid_token' };
    }

    const userId = Number(tokenRow.user_id);
    const nextEmail = tokenRow.new_email.trim().toLowerCase();

    const existing = await this.usersRepo.getByEmail(nextEmail);
    if (existing != null && Number(existing.id) !== userId) {
      return { ok: false, reason: 'email_taken' };
    }

    const user = await this.usersRepo.getById(String(userId));
    if (user == null) {
      return { ok: false, reason: 'invalid_token' };
    }

    const billing = await moveBillingEmail(
      this.usersRepo,
      this.stripeCustomers,
      { userId, currentEmail: String(user.email), newEmail: nextEmail }
    );
    if (!billing.ok) {
      if (billing.reason === 'subscription_address_taken') {
        return { ok: false, reason: 'email_taken' };
      }
      if (billing.reason === 'payer_relay_address') {
        return { ok: false, reason: 'payer_relay_address' };
      }
      return { ok: false, reason: 'billing_update_failed' };
    }

    let result: Awaited<ReturnType<UsersRepository['applyEmailChange']>>;
    try {
      result = await this.usersRepo.applyEmailChange({
        userId,
        newEmail: nextEmail,
        tokenId: Number(tokenRow.id),
      });
    } catch (error) {
      await billing.revert();
      throw error;
    }

    if (!result.ok) {
      await billing.revert();
      return result;
    }

    await this.revokeSessions(userId);
    return { ok: true, userId };
  }
}
