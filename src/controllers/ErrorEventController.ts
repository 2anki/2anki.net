import { Request, Response } from 'express';
import {
  IngestErrorEventUseCase,
  ErrorEventPayload,
} from '../usecases/events/IngestErrorEventUseCase';
import {
  InMemoryRateLimiter,
  RateLimiter,
} from '../lib/rateLimit/InMemoryRateLimiter';
import { hashIp, resolveClientIp } from '../lib/rateLimit/ipHelpers';
import { isBotUserAgent } from '../lib/http/isBotUserAgent';

const MAX_BODY_BYTES = 10 * 1024;
const RATE_WINDOW_MS = 60_000;
const PER_IP_MAX = 10;
const GLOBAL_MAX = 1000;
const MAX_RELEASE_LENGTH = 40;

function validatePayload(body: unknown): ErrorEventPayload | null {
  if (body == null || typeof body !== 'object' || Array.isArray(body)) {
    return null;
  }
  const b = body as Record<string, unknown>;
  if (typeof b.message !== 'string' || b.message.trim().length === 0) {
    return null;
  }
  return {
    message: b.message,
    stack: typeof b.stack === 'string' ? b.stack : null,
    url: typeof b.url === 'string' ? b.url : null,
    userAgent: typeof b.userAgent === 'string' ? b.userAgent : null,
    release:
      typeof b.release === 'string'
        ? b.release.slice(0, MAX_RELEASE_LENGTH)
        : null,
    userId: typeof b.userId === 'number' ? b.userId : null,
    context:
      b.context != null &&
      typeof b.context === 'object' &&
      !Array.isArray(b.context)
        ? (b.context as Record<string, unknown>)
        : null,
  };
}

function resolvePageUrl(
  payloadUrl: string | null | undefined,
  req: Request
): string | null {
  if (payloadUrl != null) {
    return payloadUrl;
  }
  const referer = req.headers.referer;
  if (typeof referer === 'string' && referer.length > 0) {
    return referer;
  }
  return null;
}

export class ErrorEventController {
  private readonly rateLimiter: RateLimiter;

  constructor(
    private readonly ingestUseCase: IngestErrorEventUseCase,
    rateLimiter?: RateLimiter
  ) {
    this.rateLimiter =
      rateLimiter ??
      new InMemoryRateLimiter({
        windowMs: RATE_WINDOW_MS,
        perKeyMax: PER_IP_MAX,
        globalMax: GLOBAL_MAX,
      });
  }

  async ingest(req: Request, res: Response): Promise<void> {
    const rawBody = JSON.stringify(req.body);
    if (rawBody.length > MAX_BODY_BYTES) {
      res.status(413).json({ error: 'Payload too large' });
      return;
    }

    const payload = validatePayload(req.body);
    if (payload == null) {
      res.status(400).json({ error: 'Invalid payload' });
      return;
    }
    payload.url = resolvePageUrl(payload.url, req);

    if (isBotUserAgent(payload.userAgent)) {
      res.status(202).end();
      return;
    }

    const rawIp = resolveClientIp(req);
    const ipHash = hashIp(rawIp);

    const allowed = this.rateLimiter.check(ipHash);
    if (!allowed) {
      res.set('Retry-After', '60');
      res.status(429).json({ error: 'Rate limit exceeded' });
      return;
    }

    const source = req.body.source === 'server' ? 'server' : 'web';

    await this.ingestUseCase.execute({ source, payload, ipHash });
    res.status(202).end();
  }
}
