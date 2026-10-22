import type { IAnonymousPassRepository } from '../../data_layer/AnonymousPassRepository';
import type { IUserPassRepository } from '../../data_layer/UserPassRepository';
import type { EventsSink } from '../../services/events/EventsSink';
import { emailHash } from '../../lib/emailHash';
import type { ValidateAnonymousPassUseCase } from '../checkout/ValidateAnonymousPassUseCase';

// The pass token is the Stripe session id the buyer's browser holds. A
// signed-in request that presents it moves the pass to that account, keeping
// its current window, but only when the account email is the one the pass was
// bought with: a token left in a shared browser must not hand the pass to
// whoever signs in next. Any other case keeps the emailed claim link. The
// validator only answers valid for an active pass no account has claimed, so a
// pass already claimed elsewhere, refunded or ended is left alone.
export class ClaimPassFromTokenUseCase {
  constructor(
    private readonly validator: Pick<ValidateAnonymousPassUseCase, 'execute'>,
    private readonly anonPassRepo: IAnonymousPassRepository,
    private readonly userPassRepo: IUserPassRepository,
    private readonly eventsSink?: Pick<EventsSink, 'record'>
  ) {}

  async execute(
    userId: number,
    userEmail: string,
    passToken: string,
    now: Date = new Date()
  ): Promise<boolean> {
    const result = await this.validator.execute(passToken, now);
    if (!result.valid || result.pass == null) {
      return false;
    }
    const pass = result.pass;
    if (
      pass.buyer_email_hash == null ||
      pass.buyer_email_hash !== emailHash(userEmail)
    ) {
      return false;
    }

    const claimed = await this.anonPassRepo.claim(pass.id, userId);
    if (!claimed) {
      return false;
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

    this.eventsSink?.record({
      name: 'anonymous_pass_claimed',
      user_id: userId,
      props: { kind: pass.kind, method: 'session' },
      created_at: now,
    });
    return true;
  }
}
