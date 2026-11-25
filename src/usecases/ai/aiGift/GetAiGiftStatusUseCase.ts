import {
  buildGiftBalance,
  giftIsActive,
} from '../../../lib/claude/aiCredits/gift/giftBalance';
import {
  AI_GIFT_CLAIMS_CLOSE_AT,
  AI_GIFT_CREDITS_PER_CLAIM,
  AI_GIFT_DURATION_MS,
  AI_GIFT_HOURS,
  AI_GIFT_MIN_MONTHLY_CARDS,
  giftBudgetHasRoom,
  giftClaimsOpen,
  giftExpiresAt,
} from '../../../lib/claude/aiCredits/gift/giftTerms';
import { giftMarkerHeld } from '../../../lib/claude/aiCredits/gift/giftConversionMarker';
import { accountHasClaudeCardsByDefault } from '../../../lib/upload/claudeCardsDefault';
import type { AiGiftDeps } from './aiGiftDeps';

export type AiGiftStatus =
  | { state: 'closed'; feedbackDue: boolean }
  | {
      state: 'open';
      credits: number;
      expiresIfClaimedNow: Date;
      claimClosesAt: Date;
      feedbackDue: false;
      lastsHours: number | null;
      minMonthlyCards: number;
    }
  | { state: 'full'; feedbackDue: false }
  | {
      state: 'claimed';
      credits: number;
      expiresAt: Date;
      feedbackDue: boolean;
      inUse: boolean;
      minMonthlyCards: number;
      claudeByDefaultOnGift: boolean | null;
      monthlyCardsLeft: number | null;
    };

const CLOSED: AiGiftStatus = { state: 'closed', feedbackDue: false };

const UNKNOWN_DEFAULT = { claudeByDefaultOnGift: null, monthlyCardsLeft: null };

export class GetAiGiftStatusUseCase {
  constructor(private readonly deps: AiGiftDeps) {}

  // The same rule an upload applies: the gift turns Claude cards on by
  // default only for an account with no paid plan, while it would pay
  // (credits left, no gift conversion running, the month's card minimum left)
  // and the account never chose for itself.
  // A failed read answers unknown, which the page shows as nothing promised.
  private async claudeDefaultOnGift(
    userId: number,
    paying: boolean,
    credits: number,
    inUse: boolean
  ): Promise<{
    claudeByDefaultOnGift: boolean | null;
    monthlyCardsLeft: number | null;
  }> {
    const readers = this.deps.claudeDefault;
    if (readers == null) return UNKNOWN_DEFAULT;
    try {
      const monthlyCardsLeft = await readers.remainingMonthlyCards(userId);
      const giftPays =
        !paying &&
        credits > 0 &&
        !inUse &&
        monthlyCardsLeft >= AI_GIFT_MIN_MONTHLY_CARDS;
      const claudeByDefaultOnGift =
        giftPays &&
        (await accountHasClaudeCardsByDefault(
          userId,
          giftPays,
          await readers.storedCardOptions(userId),
          readers
        ));
      return { claudeByDefaultOnGift, monthlyCardsLeft };
    } catch (error) {
      console.warn('[ai-gift] Claude default read failed', error);
      return UNKNOWN_DEFAULT;
    }
  }

  async execute(userId: number | null, paying: boolean): Promise<AiGiftStatus> {
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
          const credits = buildGiftBalance(grant, spendUsd).credits;
          const inUse = giftMarkerHeld(userId, now.getTime());
          return {
            state: 'claimed',
            credits,
            expiresAt: grant.expiresAt,
            feedbackDue,
            inUse,
            minMonthlyCards: AI_GIFT_MIN_MONTHLY_CARDS,
            ...(await this.claudeDefaultOnGift(userId, paying, credits, inUse)),
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
    const expiresIfClaimedNow = giftExpiresAt(now);
    const lastsFullLength =
      expiresIfClaimedNow.getTime() - now.getTime() === AI_GIFT_DURATION_MS;
    return {
      state: 'open',
      credits: AI_GIFT_CREDITS_PER_CLAIM,
      expiresIfClaimedNow,
      claimClosesAt: AI_GIFT_CLAIMS_CLOSE_AT,
      feedbackDue: false,
      lastsHours: lastsFullLength ? AI_GIFT_HOURS : null,
      minMonthlyCards: AI_GIFT_MIN_MONTHLY_CARDS,
    };
  }
}
