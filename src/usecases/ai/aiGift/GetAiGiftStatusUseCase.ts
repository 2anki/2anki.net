import {
  buildGiftBalance,
  giftIsActive,
} from '../../../lib/claude/aiCredits/gift/giftBalance';
import {
  AI_GIFT_CREDITS_EXPIRE_BY,
  AI_GIFT_CREDITS_PER_CLAIM,
  AI_GIFT_MAX_CLAIMS_PER_IP,
  AI_GIFT_MIN_MONTHLY_CARDS,
  AI_GIFT_VALID_DAYS,
  giftBudgetHasRoom,
  giftClaimsOpen,
} from '../../../lib/claude/aiCredits/gift/giftTerms';
import { giftMarkerHeld } from '../../../lib/claude/aiCredits/gift/giftConversionMarker';
import { claudeCardsByDefault } from '../../../lib/upload/claudeCardsDefault';
import { giftWouldPayForUpload } from '../../../lib/claude/aiCredits/gift/giftPaysForUpload';
import { readAiBudgetStatus } from '../../../lib/claude/aiSpendGuard';
import CardOption from '../../../lib/parser/Settings/CardOption';
import { pagePairsSuppressesAi } from '../../../infrastracture/adapters/fileConversion/pagePairsSuppressesAi';
import type { AiGiftDeps } from './aiGiftDeps';

interface GiftTermsStatus {
  validDays: number;
  endsAt: Date;
  minMonthlyCards: number;
}

// hasCredits is the one answer the page shows the offer on: whether this
// account's next upload would run on gift credits. An account with no grant
// has the whole amount until its first AI call makes one. A paying account
// never has it: its plan pays first, and the offer's switch must not send a
// paying account's uploads to Claude that its own default would not.
export type AiGiftStatus =
  | { state: 'closed'; feedbackDue: boolean }
  | (GiftTermsStatus &
      Partial<NextUploadAnswers> & {
        state: 'open';
        credits: number;
        hasCredits: boolean;
        feedbackDue: false;
      })
  | { state: 'full'; feedbackDue: false }
  | (GiftTermsStatus &
      NextUploadAnswers & {
        state: 'claimed';
        credits: number;
        hasCredits: boolean;
        expiresAt: Date;
        firstUsed: boolean;
        feedbackDue: boolean;
        inUse: boolean;
      });

const TERMS: GiftTermsStatus = {
  validDays: AI_GIFT_VALID_DAYS,
  endsAt: AI_GIFT_CREDITS_EXPIRE_BY,
  minMonthlyCards: AI_GIFT_MIN_MONTHLY_CARDS,
};

const CLOSED: AiGiftStatus = { state: 'closed', feedbackDue: false };

interface NextUploadAnswers {
  claudeDefaultForPdf: boolean | null;
  aiBudgetAvailable: boolean | null;
  storedPdfSkipsClaude: boolean | null;
  monthlyCardsLeft: number | null;
}

const UNKNOWN_NEXT_UPLOAD: NextUploadAnswers = {
  claudeDefaultForPdf: null,
  aiBudgetAvailable: null,
  storedPdfSkipsClaude: null,
  monthlyCardsLeft: null,
};

// The conversion's own reasons a PDF never reaches Claude, read from the
// account's saved options: page pairs, and PDF processing switched off (the
// PDF is then not converted at all).
function storedOptionsSkipClaude(stored: Record<string, unknown>): boolean {
  const settings = new CardOption(stored as Record<string, string>);
  return (
    settings.processPDFs === false ||
    pagePairsSuppressesAi(settings, [{ name: PROBE_PDF }])
  );
}

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
  // the wallet that upload would use. An account with no plan and no grant
  // yet has the whole amount, which its first upload makes into a grant. A
  // failed read answers unknown, which the page shows as nothing promised.
  // The default rule gives an account the gift pays for the same answer for
  // every input Claude cards read, so the PDF answer stands for all of them.
  private async nextUploadAnswers(
    userId: number,
    paying: boolean,
    grantHeld: boolean
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
      const aiBudgetAvailable =
        !paying && !grantHeld
          ? true
          : !(
              await readAiBudgetStatus(
                paying ? { userId } : { userId, aiGift: 'only' },
                readers.budgetDeps
              )
            ).exhausted;
      return {
        claudeDefaultForPdf,
        aiBudgetAvailable,
        storedPdfSkipsClaude: storedOptionsSkipClaude(
          storedOptionsRecord(stored)
        ),
        monthlyCardsLeft,
      };
    } catch (error) {
      console.warn('[ai-gift] next upload read failed', error);
      return UNKNOWN_NEXT_UPLOAD;
    }
  }

  private async networkHasRoom(
    ipHash: string | null,
    now: Date
  ): Promise<boolean> {
    if (ipHash == null) return true;
    const grants = await this.deps.gifts.networkGrantCount(ipHash, now);
    return grants < AI_GIFT_MAX_CLAIMS_PER_IP;
  }

  // A grant is made at the account's first upload the gift pays for, so an
  // account with none is shown the whole amount while the gift is open, the
  // total has room and its network is under the daily limit. A paying account
  // without a grant is not offered one: its plan pays for its AI.
  async execute(
    userId: number | null,
    paying: boolean,
    ipHash: string | null = null
  ): Promise<AiGiftStatus> {
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
            ...TERMS,
            state: 'claimed',
            credits,
            hasCredits: credits > 0 && !paying,
            expiresAt: grant.expiresAt,
            firstUsed: grant.firstUsedAt != null,
            feedbackDue,
            inUse,
            ...(await this.nextUploadAnswers(userId, paying, true)),
          };
        }
        return { state: 'closed', feedbackDue };
      }
      if (paying) {
        return CLOSED;
      }
    }
    if (!giftClaimsOpen(now)) {
      return CLOSED;
    }
    const exposure = await this.deps.exposureCredits(now);
    if (
      !giftBudgetHasRoom(exposure) ||
      !(await this.networkHasRoom(ipHash, now))
    ) {
      return { state: 'full', feedbackDue: false };
    }
    const open = {
      ...TERMS,
      state: 'open' as const,
      credits: AI_GIFT_CREDITS_PER_CLAIM,
      feedbackDue: false as const,
    };
    if (userId == null) {
      return { ...open, hasCredits: false };
    }
    return {
      ...open,
      hasCredits: true,
      ...(await this.nextUploadAnswers(userId, false, false)),
    };
  }
}
