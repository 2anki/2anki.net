import { NextFunction, Request, Response } from 'express';

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
  type ThinDeckAiPreviewOutcome,
} from '../../usecases/uploads/GenerateThinDeckAiPreviewUseCase';

// The consent field is the proof that the person tapped the preview button.
// Without it nothing is read and nothing is sent to Claude.
export const THIN_DECK_CONSENT_FIELD = 'consent';
export const THIN_DECK_CONSENT_VALUE = 'claude';

// Multer buffers the whole body in memory before the controller runs, and the
// origin check is only an allowlist a script can spoof. So the flag and a small
// in-flight cap are checked first, and a refused request never buffers a file.
export const THIN_DECK_MAX_IN_FLIGHT = 4;
// One address cannot hold every slot, and a body that has not arrived within
// the deadline is cut off (the socket is destroyed, which frees the slot), so a
// stalled upload cannot starve the endpoint. The deadline covers only the
// upload; once the body is in, the slot is held until the response ends.
export const THIN_DECK_MAX_IN_FLIGHT_PER_IP = 2;
export const THIN_DECK_SLOT_DEADLINE_MS = 60_000;
// After the body is in, reading the file and the Claude call must finish inside
// this budget or the person gets "unavailable" and the slot frees. The work is
// already counted against the rate limits, so an orphaned call stays bounded.
export const THIN_DECK_WORK_DEADLINE_MS = 40_000;
const CLEAR_DEADLINE_KEY = 'thinDeckClearUploadDeadline';

// Only a PDF needs the whole file; text types are cut before they are decoded
// so a huge text upload cannot stall the event loop on its way to a 12k sample.
const TEXT_DECODE_MAX_BYTES = 1024 * 1024;

function isPdfName(filename: string): boolean {
  return /\.pdf$/i.test(filename);
}

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

  private inFlight = 0;

  private readonly inFlightByIp = new Map<string, number>();

  guard = async (
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> => {
    if (!(await getFeatureFlag(THIN_DECK_AI_OFFER_FLAG, false))) {
      res.status(404).json({ code: 'not_available' });
      return;
    }
    const ipKey = hashIp(ipRateLimitBucket(resolveClientIp(req)));
    const fromThisIp = this.inFlightByIp.get(ipKey) ?? 0;
    if (
      this.inFlight >= THIN_DECK_MAX_IN_FLIGHT ||
      fromThisIp >= THIN_DECK_MAX_IN_FLIGHT_PER_IP
    ) {
      res.status(429).json({ code: 'busy' });
      return;
    }
    this.inFlight += 1;
    this.inFlightByIp.set(ipKey, fromThisIp + 1);
    let released = false;
    const release = () => {
      if (released) {
        return;
      }
      released = true;
      clearTimeout(deadline);
      this.inFlight -= 1;
      const remaining = (this.inFlightByIp.get(ipKey) ?? 1) - 1;
      if (remaining > 0) {
        this.inFlightByIp.set(ipKey, remaining);
      } else {
        this.inFlightByIp.delete(ipKey);
      }
    };
    const deadline = setTimeout(() => {
      if (!res.headersSent) {
        res.status(408).json({ code: 'too_slow' });
      }
      req.destroy();
    }, THIN_DECK_SLOT_DEADLINE_MS);
    deadline.unref();
    res.locals[CLEAR_DEADLINE_KEY] = () => clearTimeout(deadline);
    res.once('finish', release);
    res.once('close', release);
    next();
  };

  bodyReceived = (_req: Request, res: Response, next: NextFunction): void => {
    const clear = res.locals[CLEAR_DEADLINE_KEY] as (() => void) | undefined;
    clear?.();
    next();
  };

  private async withinWorkDeadline(
    work: Promise<ThinDeckAiPreviewOutcome>
  ): Promise<ThinDeckAiPreviewOutcome> {
    work.catch(() => undefined);
    let timer: NodeJS.Timeout | undefined;
    const late = new Promise<ThinDeckAiPreviewOutcome>((resolve) => {
      timer = setTimeout(
        () => resolve({ kind: 'unavailable' }),
        THIN_DECK_WORK_DEADLINE_MS
      );
    });
    try {
      return await Promise.race([work, late]);
    } finally {
      clearTimeout(timer);
    }
  }

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
    const work = generateThinDeckAiPreview(
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
          const readable = isPdfName(filename)
            ? bytes
            : bytes.subarray(0, TEXT_DECODE_MAX_BYTES);
          const text = await extractPreviewText(filename, readable);
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
    const outcome = await this.withinWorkDeadline(work);
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
