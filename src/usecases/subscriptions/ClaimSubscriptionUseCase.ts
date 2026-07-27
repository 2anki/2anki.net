import crypto from 'node:crypto';
import type { IEmailService } from '../../services/EmailService/EmailService';
import type { ISubscriptionClaimTokensRepository } from '../../data_layer/SubscriptionClaimTokensRepository';
import type { ISubscriptionClaimAuditRepository } from '../../data_layer/SubscriptionClaimAuditRepository';
import type { SubscriptionService } from '../../services/SubscriptionService';
import type { Stripe as StripeTypes } from 'stripe/cjs/stripe.core';
import type { UsersId } from '../../data_layer/public/Users';
import hashToken from '../../lib/misc/hashToken';

const ONE_HOUR_MS = 60 * 60 * 1000;
const MAX_ATTEMPTS_PER_USER_PER_HOUR = 12;
const MAX_ATTEMPTS_PER_IP_PER_HOUR = 60;
const TOKEN_TTL_MS = 15 * 60 * 1000;

export const CLAIM_INITIATE_MESSAGE =
  'If a subscription or pass exists for that email, we sent a confirmation link.';

export interface ClaimSubscriptionInput {
  userId: number;
  submittedEmail: string;
  ipHash: string;
  emailHash: string;
}

export class ClaimSubscriptionUseCase {
  constructor(
    private readonly tokensRepo: ISubscriptionClaimTokensRepository,
    private readonly auditRepo: ISubscriptionClaimAuditRepository,
    private readonly emailService: IEmailService,
    private readonly subscriptionService: typeof SubscriptionService,
    private readonly stripe: StripeTypes,
    private readonly domain: string = process.env.DOMAIN ?? 'https://2anki.net'
  ) {}

  async execute(input: ClaimSubscriptionInput): Promise<{ message: string }> {
    const hourAgo = new Date(Date.now() - ONE_HOUR_MS);

    const userAttempts = await this.tokensRepo.countRecentByUser(
      input.userId,
      hourAgo
    );
    if (userAttempts >= MAX_ATTEMPTS_PER_USER_PER_HOUR) {
      return { message: CLAIM_INITIATE_MESSAGE };
    }

    const ipAttempts = await this.auditRepo.countRecentByIp(
      input.ipHash,
      hourAgo
    );
    if (ipAttempts >= MAX_ATTEMPTS_PER_IP_PER_HOUR) {
      return { message: CLAIM_INITIATE_MESSAGE };
    }

    await this.auditRepo.insert({
      user_id: input.userId,
      email_hash: input.emailHash,
      ip_hash: input.ipHash,
      outcome: 'initiate',
    });

    const activeSubs =
      await this.subscriptionService.findActiveStripeSubscriptions(
        input.submittedEmail
      );

    if (activeSubs.length > 0) {
      const firstSub = activeSubs[0];
      const stripeCustomer = firstSub.customer;
      const stripeCustomerId =
        typeof stripeCustomer === 'string'
          ? stripeCustomer
          : (stripeCustomer?.id ?? '');

      const customer = (await this.stripe.customers.retrieve(
        stripeCustomerId
      )) as StripeTypes.Customer;
      const recipientEmail = customer.email ?? input.submittedEmail;

      const rawToken = crypto.randomUUID();
      const tokenHash = hashToken(rawToken);
      const expiresAt = new Date(Date.now() + TOKEN_TTL_MS);

      await this.tokensRepo.insert({
        user_id: input.userId as UsersId,
        stripe_customer_id: stripeCustomerId,
        token_hash: tokenHash,
        expires_at: expiresAt,
      });

      const claimUrl = `${this.domain}/account/claim?token=${encodeURIComponent(rawToken)}`;
      await this.emailService.sendSubscriptionClaimConfirmation(
        recipientEmail,
        claimUrl
      );
    }

    return { message: CLAIM_INITIATE_MESSAGE };
  }
}
