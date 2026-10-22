import type { IAnonymousPassRepository } from '../../data_layer/AnonymousPassRepository';
import type { IUserPassRepository } from '../../data_layer/UserPassRepository';
import type { EventsSink } from '../../services/events/EventsSink';
import type { ValidateAnonymousPassUseCase } from '../checkout/ValidateAnonymousPassUseCase';

// The pass token is the Stripe session id the buyer's browser holds, the same
// bearer credential that already unlocks the pass without an account. A
// signed-in request that presents it proves the same ownership, so the pass
// moves to that account and keeps its current window. The validator only
// answers valid for an active pass no account has claimed, so a pass already
// claimed elsewhere, refunded or ended is left alone.
export class ClaimPassFromTokenUseCase {
  constructor(
    private readonly validator: Pick<ValidateAnonymousPassUseCase, 'execute'>,
    private readonly anonPassRepo: IAnonymousPassRepository,
    private readonly userPassRepo: IUserPassRepository,
    private readonly eventsSink?: Pick<EventsSink, 'record'>
  ) {}

  async execute(
    userId: number,
    passToken: string,
    now: Date = new Date()
  ): Promise<boolean> {
    const result = await this.validator.execute(passToken, now);
    if (!result.valid || result.pass == null) {
      return false;
    }
    const pass = result.pass;

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
