import express from 'express';

import {
  InMemoryRateLimiter,
  RateLimiter,
} from '../../lib/rateLimit/InMemoryRateLimiter';
import { hashIp, resolveClientIp } from '../../lib/rateLimit/ipHelpers';
import { ConvertSampleDeckUseCase } from '../../usecases/uploads/ConvertSampleDeckUseCase';
import { getOwnerId } from '../../lib/User/getOwner';
import { track } from '../../services/events/track';

const SAMPLE_WINDOW_MS = 60_000;
const SAMPLE_PER_IP_MAX = 20;
const SAMPLE_GLOBAL_MAX = 1_000;

function resolveAnonId(req: express.Request): string | null {
  const cookies = req.cookies as Record<string, unknown> | undefined;
  const anonId = cookies?.anon_id;
  return typeof anonId === 'string' && anonId.length > 0 ? anonId : null;
}

export class SampleUploadController {
  private readonly rateLimiter: RateLimiter;

  constructor(
    private readonly useCase: ConvertSampleDeckUseCase,
    rateLimiter?: RateLimiter
  ) {
    this.rateLimiter =
      rateLimiter ??
      new InMemoryRateLimiter({
        windowMs: SAMPLE_WINDOW_MS,
        perKeyMax: SAMPLE_PER_IP_MAX,
        globalMax: SAMPLE_GLOBAL_MAX,
      });
  }

  async sample(req: express.Request, res: express.Response) {
    if (!this.rateLimiter.check(hashIp(resolveClientIp(req)))) {
      res.set('Retry-After', '60');
      return res.status(429).json({
        message:
          'Too many sample requests. Please wait a minute and try again.',
      });
    }

    const { apkg, cardCount, deckName } = await this.useCase.execute();

    res.set('Content-Type', 'application/apkg');
    res.set('Content-Length', Buffer.byteLength(apkg).toString());
    res.set('X-Card-Count', cardCount.toString());
    res.set('Access-Control-Expose-Headers', 'File-Name, X-Card-Count');
    try {
      res.set('File-Name', encodeURIComponent(deckName));
    } catch {
      console.info(`sample: failed to encode filename ${deckName}`);
    }
    res.attachment(`/${deckName}`);

    track('sample_conversion_succeeded', {
      userId: getOwnerId(res),
      anonymousId: resolveAnonId(req),
      props: { source: 'sample', card_count: cardCount },
    });

    return res.status(200).send(apkg);
  }
}

export default SampleUploadController;
