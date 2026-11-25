import type express from 'express';
import { getOwnerId } from '../lib/User/getOwner';
import { isPaying } from '../lib/isPaying';
import { giftNetworkHash } from '../lib/claude/aiCredits/gift/giftNetworkHash';
import type {
  AiGiftStatus,
  GetAiGiftStatusUseCase,
} from '../usecases/ai/aiGift/GetAiGiftStatusUseCase';
import type {
  AiGiftFeedbackAnswer,
  RecordAiGiftFeedbackUseCase,
} from '../usecases/ai/aiGift/RecordAiGiftFeedbackUseCase';

const FEEDBACK_ANSWERS = new Set<AiGiftFeedbackAnswer>([
  'yes',
  'no',
  'dismissed',
]);

function isFeedbackAnswer(value: unknown): value is AiGiftFeedbackAnswer {
  return (
    typeof value === 'string' &&
    FEEDBACK_ANSWERS.has(value as AiGiftFeedbackAnswer)
  );
}

function nextUploadBody(result: {
  claudeDefaultForPdf?: boolean | null;
  aiBudgetAvailable?: boolean | null;
  storedPdfSkipsClaude?: boolean | null;
  monthlyCardsLeft?: number | null;
}) {
  if (result.claudeDefaultForPdf === undefined) return {};
  return {
    claudeDefaultForPdf: result.claudeDefaultForPdf,
    aiBudgetAvailable: result.aiBudgetAvailable ?? null,
    storedPdfSkipsClaude: result.storedPdfSkipsClaude ?? null,
    monthlyCardsLeft: result.monthlyCardsLeft ?? null,
  };
}

function statusBody(result: AiGiftStatus) {
  switch (result.state) {
    case 'open':
      return {
        state: 'open',
        credits: result.credits,
        hasCredits: result.hasCredits,
        validDays: result.validDays,
        endsAt: result.endsAt.toISOString(),
        minMonthlyCards: result.minMonthlyCards,
        feedbackDue: false,
        ...nextUploadBody(result),
      };
    case 'claimed':
      return {
        state: 'claimed',
        credits: result.credits,
        hasCredits: result.hasCredits,
        expiresAt: result.expiresAt.toISOString(),
        firstUsed: result.firstUsed,
        validDays: result.validDays,
        endsAt: result.endsAt.toISOString(),
        feedbackDue: result.feedbackDue,
        inUse: result.inUse,
        minMonthlyCards: result.minMonthlyCards,
        ...nextUploadBody(result),
      };
    case 'full':
      return { state: 'full', feedbackDue: false };
    default:
      return { state: 'closed', feedbackDue: result.feedbackDue };
  }
}

export class AiGiftController {
  constructor(
    private readonly status: GetAiGiftStatusUseCase,
    private readonly feedback: RecordAiGiftFeedbackUseCase
  ) {}

  private async statusFor(req: express.Request, res: express.Response) {
    return statusBody(
      await this.status.execute(
        getOwnerId(res),
        isPaying(res.locals),
        giftNetworkHash(req)
      )
    );
  }

  async getStatus(req: express.Request, res: express.Response) {
    const body = await this.statusFor(req, res);
    res.set('Cache-Control', 'private, no-store');
    return res.json(body);
  }

  // Claiming is gone: a grant is made at the account's first upload the gift
  // pays for. A page opened before that change still posts here, so it gets
  // the account's status back and nothing is stored.
  async claim(req: express.Request, res: express.Response) {
    if (getOwnerId(res) == null) {
      return res.status(401).json({ message: 'Authentication required' });
    }
    const body = await this.statusFor(req, res);
    res.set('Cache-Control', 'private, no-store');
    return res.json(body);
  }

  async recordFeedback(req: express.Request, res: express.Response) {
    const userId = getOwnerId(res);
    if (userId == null) {
      return res.status(401).json({ message: 'Authentication required' });
    }
    const body = (req.body ?? {}) as { answer?: unknown; comment?: unknown };
    if (!isFeedbackAnswer(body.answer)) {
      return res.status(400).json({ code: 'invalid_answer' });
    }
    const comment = typeof body.comment === 'string' ? body.comment : '';
    const result = await this.feedback.execute({
      userId,
      answer: body.answer,
      comment,
    });
    if (result.ok) {
      return res.status(204).end();
    }
    return res
      .status(result.reason === 'no_gift' ? 403 : 409)
      .json({ code: result.reason });
  }
}
