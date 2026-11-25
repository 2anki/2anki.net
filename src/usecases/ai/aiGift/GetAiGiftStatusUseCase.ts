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
import { claudeCardsByDefault } from '../../../lib/upload/claudeCardsDefault';
import { giftWouldPayForUpload } from '../../../lib/claude/aiCredits/gift/giftPaysForUpload';
import { readAiBudgetStatus } from '../../../lib/claude/aiSpendGuard';
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
      claudeDefaultForPdf: boolean | null;
      aiBudgetAvailable: boolean | null;
      monthlyCardsLeft: number | null;
    };

const CLOSED: AiGiftStatus = { state: 'closed', feedbackDue: false };

interface NextUploadAnswers {
  claudeDefaultForPdf: boolean | null;
  aiBudgetAvailable: boolean | null;
  monthlyCardsLeft: number | null;
}

const UNKNOWN_NEXT_UPLOAD: NextUploadAnswers = {
  claudeDefaultForPdf: null,
  aiBudgetAvailable: null,
  monthlyCardsLeft: null,
};

const PROBE_PDF = 'notes.pdf';

function storedOptionsRecord(stored: unknown): Record<string, unknown> {
  if (stored == null || typeof stored !== 'object' || Array.isArray(stored)) {
    return {};
  }
  return stored as Record<string, unknown>;
}

export class GetAiGiftStatusUseCase {
  constructor(private readonly deps: AiGiftDeps) {}

  // What a web PDF upload by this account would get right now, answered by
  // the functions the upload itself calls: the Claude default rule (with the
  // gift as what pays for an account with no plan) and the budget check in
  // the wallet that upload would use. A failed read answers unknown, which
  // the page shows as nothing promised.
  private async nextUploadAnswers(
    userId: number,
    paying: boolean
  ): Promise<NextUploadAnswers> {
    const readers = this.deps.claudeDefault;
    if (readers == null) return UNKNOWN_NEXT_UPLOAD;
    try {
      const monthlyCardsLeft = await readers.remainingMonthlyCards(userId);
      const stored = await readers.storedCardOptions(userId);
      const claudeDefaultForPdf = await claudeCardsByDefault(
        {
          ownerId: userId,
          paying,
          entry: 'web',
          fileNames: [PROBE_PDF],
          options: storedOptionsRecord(stored),
          storedOptions: stored,
          giftPays: () =>
            giftWouldPayForUpload(userId, {
              gift: readers.giftReaders,
              remainingMonthlyCards: async () => monthlyCardsLeft,
            }),
        },
        readers
      );
      const budget = await readAiBudgetStatus(
        paying ? { userId } : { userId, aiGift: 'only' },
        readers.budgetDeps
      );
      return {
        claudeDefaultForPdf,
        aiBudgetAvailable: !budget.exhausted,
        monthlyCardsLeft,
      };
    } catch (error) {
      console.warn('[ai-gift] next upload read failed', error);
      return UNKNOWN_NEXT_UPLOAD;
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
            ...(await this.nextUploadAnswers(userId, paying)),
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
