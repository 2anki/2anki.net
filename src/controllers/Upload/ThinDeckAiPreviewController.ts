import { Request, Response } from 'express';

import { generateAiPreview } from '../../lib/claude/aiPreview';
import { getFeatureFlag } from '../../lib/featureFlags/getFeatureFlag';
import { THIN_DECK_AI_OFFER_FLAG } from '../../lib/featureFlags/thinDeckAiOffer';
import {
  hashIp,
  ipRateLimitBucket,
  resolveClientIp,
} from '../../lib/rateLimit/ipHelpers';
import { getOwnerId } from '../../lib/User/getOwner';
import { AiPreviewRateLimiter } from '../../lib/upload/aiPreviewRateLimiter';
import { extractPreviewText } from '../../lib/upload/extractPreviewText';
import { track } from '../../services/events/track';
import {
  generateThinDeckAiPreview,
  type ThinDeckAiPreviewDeps,
} from '../../usecases/uploads/GenerateThinDeckAiPreviewUseCase';

// The consent field is the proof that the person tapped the preview button.
// Without it nothing is read and nothing is sent to Claude.
export const THIN_DECK_CONSENT_FIELD = 'consent';
export const THIN_DECK_CONSENT_VALUE = 'claude';

function readAnonId(req: Request): string | null {
  const cookies = req.cookies as Record<string, unknown> | undefined;
  const value = cookies?.anon_id;
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function visitorKeyFor(req: Request, res: Response): string | null {
  const userId = getOwnerId(res);
  if (userId != null) {
    return `user:${userId}`;
  }
  const anonId = readAnonId(req);
  return anonId == null ? null : `anon:${anonId}`;
}

export class ThinDeckAiPreviewController {
  constructor(
    private readonly limiter: AiPreviewRateLimiter = new AiPreviewRateLimiter(),
    private readonly deps: Partial<ThinDeckAiPreviewDeps> = {}
  ) {}

  async preview(req: Request, res: Response): Promise<Response> {
    const consent = (req.body as Record<string, unknown> | undefined)?.[
      THIN_DECK_CONSENT_FIELD
    ];
    if (consent !== THIN_DECK_CONSENT_VALUE) {
      return res.status(400).json({ code: 'consent_required' });
    }
    const file = req.file;
    const visitorKey = visitorKeyFor(req, res);
    if (file?.buffer == null || visitorKey == null) {
      return res.status(400).json({ code: 'file_required' });
    }
    const requestId = res.locals.requestId as string | undefined;
    const outcome = await generateThinDeckAiPreview(
      {
        visitorKey,
        ipKey: hashIp(ipRateLimitBucket(resolveClientIp(req))),
        filename: file.originalname,
        bytes: file.buffer,
        requestId,
      },
      {
        isEnabled: () => getFeatureFlag(THIN_DECK_AI_OFFER_FLAG, false),
        allow: (key, ipKey) => this.limiter.allow(key, ipKey),
        preview: async (filename, bytes, rid) => {
          const text = await extractPreviewText(filename, bytes);
          return text == null
            ? []
            : generateAiPreview(text, { requestId: rid });
        },
        onShown: (key, cardCount) => {
          const userId = getOwnerId(res);
          track('thin_deck_ai_preview_shown', {
            userId,
            anonymousId: userId == null ? readAnonId(req) : null,
            props: { card_count: cardCount },
          });
        },
        ...this.deps,
      }
    );
    if (outcome.kind === 'preview') {
      return res.status(200).json({ kind: 'preview', cards: outcome.cards });
    }
    if (outcome.kind === 'disabled') {
      return res.status(404).json({ code: 'not_available' });
    }
    return res.status(200).json({ kind: outcome.kind });
  }
}

export default ThinDeckAiPreviewController;
