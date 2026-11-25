import type express from 'express';
import { getOwnerId } from '../lib/User/getOwner';
import { ipRateLimitBucket, resolveClientIp } from '../lib/rateLimit/ipHelpers';
import hmacToken from '../lib/misc/hmacToken';
import type { GetAiGiftStatusUseCase } from '../usecases/ai/aiGift/GetAiGiftStatusUseCase';
import type {
  ClaimAiGiftRefusal,
  ClaimAiGiftUseCase,
} from '../usecases/ai/aiGift/ClaimAiGiftUseCase';
import type {
  AiGiftFeedbackAnswer,
  RecordAiGiftFeedbackUseCase,
} from '../usecases/ai/aiGift/RecordAiGiftFeedbackUseCase';

const REFUSAL_STATUS: Record<ClaimAiGiftRefusal, number> = {
  gift_closed: 410,
  gift_already_claimed: 409,
  gift_budget_full: 409,
  gift_ip_limit: 429,
};

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

// The claim cap counts claims per network, never by the raw address: the
// address is bucketed (IPv6 /64, IPv4 as is) and stored only as a keyed hash.
function claimIpHash(req: express.Request): string {
  return hmacToken(ipRateLimitBucket(resolveClientIp(req)));
}

export class AiGiftController {
  constructor(
    private readonly status: GetAiGiftStatusUseCase,
    private readonly claimGift: ClaimAiGiftUseCase,
    private readonly feedback: RecordAiGiftFeedbackUseCase
  ) {}

  async getStatus(_req: express.Request, res: express.Response) {
    const result = await this.status.execute(getOwnerId(res));
    res.set('Cache-Control', 'private, no-store');
    switch (result.state) {
      case 'open':
        return res.json({
          state: 'open',
          credits: result.credits,
          expiresIfClaimedNow: result.expiresIfClaimedNow.toISOString(),
          claimClosesAt: result.claimClosesAt.toISOString(),
          feedbackDue: false,
          ...(result.lastsHours == null
            ? {}
            : { lastsHours: result.lastsHours }),
          minMonthlyCards: result.minMonthlyCards,
        });
      case 'claimed':
        return res.json({
          state: 'claimed',
          credits: result.credits,
          expiresAt: result.expiresAt.toISOString(),
          feedbackDue: result.feedbackDue,
          inUse: result.inUse,
          minMonthlyCards: result.minMonthlyCards,
        });
      case 'full':
        return res.json({ state: 'full', feedbackDue: false });
      default:
        return res.json({ state: 'closed', feedbackDue: result.feedbackDue });
    }
  }

  async claim(req: express.Request, res: express.Response) {
    const userId = getOwnerId(res);
    if (userId == null) {
      return res.status(401).json({ message: 'Authentication required' });
    }
    const result = await this.claimGift.execute({
      userId,
      ipHash: claimIpHash(req),
    });
    if (result.ok) {
      return res.json({
        credits: result.credits,
        expiresAt: result.expiresAt.toISOString(),
      });
    }
    return res
      .status(REFUSAL_STATUS[result.reason])
      .json({ code: result.reason });
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
