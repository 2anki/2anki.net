import { Request, Response } from 'express';

import {
  AiPreviewHoldExpiredError,
  NoAiPreviewHoldError,
  ResumeAnonymousAiPreviewUseCase,
} from '../../usecases/uploads/ResumeAnonymousAiPreviewUseCase';
import { AiCreditsExhaustedError } from '../../lib/claude/aiSpendGuard';
import { EmptyDeckError } from '../../usecases/jobs/EmptyDeckError';
import { getAnonymousPassId } from '../../lib/User/getOwner';

function anonId(req: Request): string | null {
  const cookies = req.cookies as Record<string, unknown> | undefined;
  const value = cookies?.anon_id;
  return typeof value === 'string' && value.length > 0 ? value : null;
}

export class AiPreviewResumeController {
  constructor(private readonly useCase: ResumeAnonymousAiPreviewUseCase) {}

  async resume(req: Request, res: Response): Promise<Response> {
    const anonymousPassId = getAnonymousPassId(res);
    if (anonymousPassId == null) {
      return res.status(403).json({ code: 'pass_required' });
    }
    const visitor = anonId(req);
    if (visitor == null) {
      return res.status(404).json({ code: 'no_ai_preview' });
    }
    try {
      const { apkg, cardCount, deckName } = await this.useCase.execute({
        anonymousPassId,
        anonId: visitor,
        requestId: res.locals.requestId as string | undefined,
      });
      res.attachment(`/${deckName}`);
      res.set('Content-Type', 'application/apkg');
      res.set('Content-Length', Buffer.byteLength(apkg).toString());
      res.set('X-Card-Count', cardCount.toString());
      try {
        res.set('File-Name', encodeURIComponent(deckName));
      } catch {
        // A deck name that can't be URI-encoded still ships the apkg; the
        // client falls back to its default download filename.
      }
      res.set('Access-Control-Expose-Headers', 'File-Name, X-Card-Count');
      return res.status(200).send(apkg);
    } catch (err) {
      if (err instanceof NoAiPreviewHoldError) {
        return res.status(404).json({ code: 'no_ai_preview' });
      }
      if (err instanceof AiPreviewHoldExpiredError) {
        return res.status(410).json({ code: 'ai_preview_expired' });
      }
      if (err instanceof AiCreditsExhaustedError) {
        return res.status(402).json({ code: 'ai_credits_exhausted' });
      }
      if (err instanceof EmptyDeckError) {
        return res.status(400).json({ code: 'empty_export' });
      }
      throw err;
    }
  }
}

export default AiPreviewResumeController;
