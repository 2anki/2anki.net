import {
  buildGiftBalance,
  giftIsActive,
} from '../../../lib/claude/aiCredits/gift/giftBalance';
import {
  AI_GIFT_CLAIMS_CLOSE_AT,
  AI_GIFT_CREDITS_PER_CLAIM,
  giftBudgetHasRoom,
  giftClaimsOpen,
  giftExpiresAt,
} from '../../../lib/claude/aiCredits/gift/giftTerms';
import { giftMarkerHeld } from '../../../lib/claude/aiCredits/gift/giftConversionMarker';
import type { AiGiftDeps } from './aiGiftDeps';

export type AiGiftStatus =
  | { state: 'closed'; feedbackDue: boolean }
  | {
      state: 'open';
      credits: number;
      expiresIfClaimedNow: Date;
      claimClosesAt: Date;
      feedbackDue: false;
    }
  | { state: 'full'; feedbackDue: false }
  | {
      state: 'claimed';
      credits: number;
      expiresAt: Date;
      feedbackDue: boolean;
      inUse: boolean;
    };

const CLOSED: AiGiftStatus = { state: 'closed', feedbackDue: false };

export class GetAiGiftStatusUseCase {
  constructor(private readonly deps: AiGiftDeps) {}

  async execute(userId: number | null): Promise<AiGiftStatus> {
    if (!(await this.deps.isEnabled())) {
      return CLOSED;
    }
    const now = this.deps.now();
    if (userId != null) {
      const grant = await this.deps.gifts.findGrant(userId);
      if (grant != null) {
        const spendUsd = await this.deps.gifts.giftCostSince(
          grant.id,
          userId,
          grant.claimedAt
        );
        const feedbackDue = spendUsd > 0 && grant.feedbackAnsweredAt == null;
        if (giftIsActive(grant, now)) {
          return {
            state: 'claimed',
            credits: buildGiftBalance(grant, spendUsd).credits,
            expiresAt: grant.expiresAt,
            feedbackDue,
            inUse: giftMarkerHeld(userId, now.getTime()),
          };
        }
        return { state: 'closed', feedbackDue };
      }
    }
    if (!giftClaimsOpen(now)) {
      return CLOSED;
    }
    const exposure = await this.deps.exposureCredits(now);
    if (!giftBudgetHasRoom(exposure)) {
      return { state: 'full', feedbackDue: false };
    }
    return {
      state: 'open',
      credits: AI_GIFT_CREDITS_PER_CLAIM,
      expiresIfClaimedNow: giftExpiresAt(now),
      claimClosesAt: AI_GIFT_CLAIMS_CLOSE_AT,
      feedbackDue: false,
    };
  }
}
