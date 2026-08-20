import type { Stripe as StripeTypes } from 'stripe/cjs/stripe.core';
import type {
  IAnonymousPassRepository,
  AnonymousPass,
} from '../../data_layer/AnonymousPassRepository';
import type { PassKind } from '../../data_layer/UserPassRepository';
import {
  PASS_CLAIM_WINDOW_MS,
  PASS_DURATION_MS,
  isAnonymousPassKind,
} from '../passes/passDurations';

export interface ValidateAnonymousPassResult {
  valid: boolean;
  pass?: AnonymousPass;
}

export class ValidateAnonymousPassUseCase {
  constructor(
    private readonly anonPassRepo: IAnonymousPassRepository,
    private readonly stripe?: Pick<StripeTypes, 'checkout'>
  ) {}

  async execute(
    stripeSessionId: string,
    now: Date = new Date()
  ): Promise<ValidateAnonymousPassResult> {
    if (stripeSessionId === '') {
      return { valid: false };
    }

    const active = await this.anonPassRepo.findActive(stripeSessionId, now);
    if (active != null) {
      return { valid: true, pass: await this.ensureActivated(active, now) };
    }

    const existing = await this.anonPassRepo.findBySessionId(stripeSessionId);
    if (existing != null) {
      return { valid: false };
    }

    return this.reconcileFromStripe(stripeSessionId, now);
  }

  private async ensureActivated(
    pass: AnonymousPass,
    now: Date
  ): Promise<AnonymousPass> {
    if (pass.activated_at != null || !isAnonymousPassKind(pass.kind)) {
      return pass;
    }
    const expiresAt = new Date(now.getTime() + PASS_DURATION_MS[pass.kind]);
    const activated = await this.anonPassRepo.activate(pass.id, now, expiresAt);
    return activated ?? pass;
  }

  private async reconcileFromStripe(
    stripeSessionId: string,
    now: Date
  ): Promise<ValidateAnonymousPassResult> {
    if (this.stripe == null || !stripeSessionId.startsWith('cs_')) {
      return { valid: false };
    }

    try {
      const session =
        await this.stripe.checkout.sessions.retrieve(stripeSessionId);
      const meta = (session.metadata ?? {}) as Record<string, string>;
      const passKind = meta.pass_kind as PassKind | undefined;
      const isPaidAnonymousPass =
        session.payment_status === 'paid' &&
        meta.pass_anonymous === '1' &&
        (passKind === '24h' || passKind === '7d');
      if (!isPaidAnonymousPass) {
        return { valid: false };
      }

      const paymentIntentId =
        typeof session.payment_intent === 'string'
          ? session.payment_intent
          : null;
      if (paymentIntentId == null) {
        return { valid: false };
      }

      const createdMs =
        session.created != null ? session.created * 1000 : now.getTime();
      const expiresAt = new Date(createdMs + PASS_CLAIM_WINDOW_MS);
      if (expiresAt <= now) {
        return { valid: false };
      }

      const pass = await this.anonPassRepo.insert({
        stripeSessionId,
        kind: passKind,
        expiresAt,
        paymentIntentId,
      });
      return { valid: true, pass: await this.ensureActivated(pass, now) };
    } catch {
      return { valid: false };
    }
  }
}
