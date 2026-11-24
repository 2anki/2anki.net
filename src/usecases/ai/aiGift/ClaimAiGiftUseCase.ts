import { track } from '../../../services/events/track';
import { withServerMarker } from '../../../lib/events/serverEventProps';
import {
  AI_GIFT_CREDITS_PER_CLAIM,
  giftClaimsOpen,
  giftExpiresAt,
} from '../../../lib/claude/aiCredits/gift/giftTerms';
import type { AiGiftClaimRefusal } from '../../../data_layer/AiCreditGiftsRepository';
import type { AiGiftDeps } from './aiGiftDeps';

export type ClaimAiGiftRefusal = AiGiftClaimRefusal | 'gift_closed';

export type ClaimAiGiftResult =
  | { ok: true; credits: number; expiresAt: Date }
  | { ok: false; reason: ClaimAiGiftRefusal };

export class ClaimAiGiftUseCase {
  constructor(private readonly deps: AiGiftDeps) {}

  async execute(input: {
    userId: number;
    ipHash: string | null;
  }): Promise<ClaimAiGiftResult> {
    const now = this.deps.now();
    if (!(await this.deps.isEnabled()) || !giftClaimsOpen(now)) {
      return this.refuse(input.userId, 'gift_closed');
    }
    const outcome = await this.deps.gifts.claim({
      userId: input.userId,
      credits: AI_GIFT_CREDITS_PER_CLAIM,
      claimedAt: now,
      expiresAt: giftExpiresAt(now),
      ipHash: input.ipHash,
    });
    if (!outcome.ok) {
      return this.refuse(input.userId, outcome.reason);
    }
    this.deps.forgetExposure();
    track('ai_gift_claimed', {
      userId: input.userId,
      props: withServerMarker({
        gift_id: outcome.grant.id,
        credits: outcome.grant.credits,
        expires_at: outcome.grant.expiresAt.toISOString(),
      }),
    });
    return {
      ok: true,
      credits: outcome.grant.credits,
      expiresAt: outcome.grant.expiresAt,
    };
  }

  private refuse(
    userId: number,
    reason: ClaimAiGiftRefusal
  ): ClaimAiGiftResult {
    if (reason === 'gift_budget_full') {
      this.deps.forgetExposure();
    }
    track('ai_gift_claim_refused', {
      userId,
      props: withServerMarker({ reason }),
    });
    return { ok: false, reason };
  }
}
