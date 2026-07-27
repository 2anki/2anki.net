import type { Knex } from 'knex';
import hmacToken from '../../lib/misc/hmacToken';
import type { IAnonymousPassRepository } from '../../data_layer/AnonymousPassRepository';
import type { IPassClaimTokensRepository } from '../../data_layer/PassClaimTokensRepository';
import type { ISubscriptionClaimAuditRepository } from '../../data_layer/SubscriptionClaimAuditRepository';
import type { IUserPassRepository } from '../../data_layer/UserPassRepository';
import type { PassKind } from '../../data_layer/UserPassRepository';

export type ConfirmPassOutcome =
  | { success: true; passKind: PassKind; expiresAt: Date }
  | {
      success: false;
      reason: 'invalid_token' | 'already_claimed' | 'pass_expired';
    };

export class ConfirmPassClaimUseCase {
  constructor(
    private readonly db: Knex,
    private readonly tokensRepo: IPassClaimTokensRepository,
    private readonly anonPassRepo: IAnonymousPassRepository,
    private readonly userPassRepo: IUserPassRepository,
    private readonly auditRepo: ISubscriptionClaimAuditRepository
  ) {}

  async execute(
    userId: number,
    rawToken: string,
    ipHash: string,
    emailHashValue: string
  ): Promise<ConfirmPassOutcome> {
    const audit = (outcome: string) =>
      this.auditRepo.insert({
        user_id: userId,
        email_hash: emailHashValue,
        ip_hash: ipHash,
        outcome,
      });

    const tokenRow = await this.tokensRepo.findByTokenHash(hmacToken(rawToken));
    if (
      tokenRow == null ||
      new Date(tokenRow.expires_at).getTime() < Date.now()
    ) {
      await audit('pass_confirm_invalid_token');
      return { success: false, reason: 'invalid_token' };
    }

    if (tokenRow.consumed_at != null) {
      await audit(
        tokenRow.user_id === userId
          ? 'pass_confirm_already_consumed'
          : 'pass_confirm_replay'
      );
      return { success: false, reason: 'already_claimed' };
    }

    const pass = await this.anonPassRepo.findById(tokenRow.anonymous_pass_id);
    if (pass == null) {
      await audit('pass_confirm_invalid_token');
      return { success: false, reason: 'invalid_token' };
    }

    if (pass.claimed_by_user_id != null) {
      await audit('pass_confirm_already_claimed');
      return { success: false, reason: 'already_claimed' };
    }

    if (pass.expires_at.getTime() <= Date.now()) {
      await audit('pass_confirm_pass_expired');
      return { success: false, reason: 'pass_expired' };
    }

    const claimed = await this.anonPassRepo.claim(pass.id, userId);
    if (!claimed) {
      await audit('pass_confirm_race');
      return { success: false, reason: 'already_claimed' };
    }

    try {
      await this.userPassRepo.upsertWithAbsoluteExpiry(
        userId,
        pass.kind,
        pass.expires_at,
        pass.payment_intent_id
      );
    } catch (error) {
      await this.anonPassRepo.unclaim(pass.id);
      throw error;
    }

    await this.db.transaction(async (trx) => {
      await this.tokensRepo.markConsumed(tokenRow.id, trx);
    });
    await audit('pass_confirm_success');

    return { success: true, passKind: pass.kind, expiresAt: pass.expires_at };
  }
}
