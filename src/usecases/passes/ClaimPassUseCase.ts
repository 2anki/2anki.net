import crypto from 'node:crypto';
import type { Stripe as StripeTypes } from 'stripe/cjs/stripe.core';
import type { IEmailService } from '../../services/EmailService/EmailService';
import type { IAnonymousPassRepository } from '../../data_layer/AnonymousPassRepository';
import type { IPassClaimTokensRepository } from '../../data_layer/PassClaimTokensRepository';
import type { ISubscriptionClaimAuditRepository } from '../../data_layer/SubscriptionClaimAuditRepository';
import type { UsersId } from '../../data_layer/public/Users';
import type { AnonymousPassesId } from '../../data_layer/public/AnonymousPasses';
import { emailHash } from '../../lib/emailHash';
import hashToken from '../../lib/misc/hashToken';
import { passKindLabel } from './passKindLabel';

const ONE_HOUR_MS = 60 * 60 * 1000;
const MAX_ATTEMPTS_PER_USER_PER_HOUR = 12;
const MAX_ATTEMPTS_PER_IP_PER_HOUR = 60;
const TOKEN_TTL_MS = 15 * 60 * 1000;
const LEGACY_HASH_BACKFILL_LIMIT = 20;

export interface ClaimPassInput {
  userId: number;
  submittedEmail: string;
  ipHash: string;
  emailHash: string;
}

export class ClaimPassUseCase {
  constructor(
    private readonly anonPassRepo: IAnonymousPassRepository,
    private readonly tokensRepo: IPassClaimTokensRepository,
    private readonly auditRepo: ISubscriptionClaimAuditRepository,
    private readonly emailService: IEmailService,
    private readonly stripe: Pick<StripeTypes, 'checkout'>,
    private readonly domain: string = process.env.DOMAIN ?? 'https://2anki.net'
  ) {}

  async execute(input: ClaimPassInput): Promise<void> {
    const now = new Date();
    const hourAgo = new Date(now.getTime() - ONE_HOUR_MS);

    const userAttempts = await this.tokensRepo.countRecentByUser(
      input.userId,
      hourAgo
    );
    if (userAttempts >= MAX_ATTEMPTS_PER_USER_PER_HOUR) {
      return;
    }

    const ipAttempts = await this.auditRepo.countRecentByIp(
      input.ipHash,
      hourAgo
    );
    if (ipAttempts >= MAX_ATTEMPTS_PER_IP_PER_HOUR) {
      return;
    }

    await this.auditRepo.insert({
      user_id: input.userId,
      email_hash: input.emailHash,
      ip_hash: input.ipHash,
      outcome: 'pass_claim_initiate',
    });

    await this.backfillLegacyEmailHashes(now);

    const matches = await this.anonPassRepo.findUnclaimedByBuyerEmailHash(
      input.emailHash,
      now
    );
    if (matches.length === 0) {
      return;
    }

    const pass = matches[0];
    const rawToken = crypto.randomUUID();
    await this.tokensRepo.insert({
      user_id: input.userId as UsersId,
      anonymous_pass_id: pass.id as AnonymousPassesId,
      token_hash: hashToken(rawToken),
      expires_at: new Date(now.getTime() + TOKEN_TTL_MS),
    });

    const claimUrl = `${this.domain}/account/claim?token=${encodeURIComponent(rawToken)}&kind=pass`;
    await this.emailService.sendPassClaimConfirmation(
      input.submittedEmail,
      claimUrl,
      passKindLabel(pass.kind)
    );
  }

  // Passes granted before buyer_email_hash existed carry a null hash; hydrate
  // them once from the Stripe session so they stay claimable. Bounded because
  // only pre-deploy rows can be in this state.
  private async backfillLegacyEmailHashes(now: Date): Promise<void> {
    const legacy = await this.anonPassRepo.findUnclaimedWithoutEmailHash(now);
    for (const row of legacy.slice(0, LEGACY_HASH_BACKFILL_LIMIT)) {
      try {
        const session = await this.stripe.checkout.sessions.retrieve(
          row.stripe_session_id
        );
        const buyerEmail =
          session.customer_details?.email ?? session.customer_email ?? null;
        if (buyerEmail != null && buyerEmail !== '') {
          await this.anonPassRepo.setBuyerEmailHash(
            row.id,
            emailHash(buyerEmail)
          );
        }
      } catch (error) {
        console.warn('pass.claim.backfill_failed', {
          anonymous_pass_id: row.id,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }
}
