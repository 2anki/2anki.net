import type { Request, Response } from 'express';

// Answering while the client is still sending lets Node close the socket with
// the rest of the body unread, which a proxy reports as a failed request body
// and turns into its own 400 or 502. So a refusal reads and discards a small
// body before it answers, and closes the connection on anything bigger or
// slower than these, without holding the bytes.
export const UNREAD_BODY_DRAIN_LIMIT_BYTES = 1024 * 1024;
export const UNREAD_BODY_DRAIN_TIME_LIMIT_MS = 10_000;

export interface DrainLimits {
  maxBytes: number;
  maxMs: number;
}

const DEFAULT_DRAIN_LIMITS: DrainLimits = {
  maxBytes: UNREAD_BODY_DRAIN_LIMIT_BYTES,
  maxMs: UNREAD_BODY_DRAIN_TIME_LIMIT_MS,
};

function declaredLength(req: Request): number | null {
  const header = req.headers['content-length'];
  if (header == null) return null;
  const length = Number(header);
  return Number.isFinite(length) ? length : null;
}

function hasUnreadBody(req: Request): boolean {
  if (req.complete === true || req.readableEnded === true) return false;
  if (req.headers['transfer-encoding'] != null) return true;
  return (declaredLength(req) ?? 0) > 0;
}

function answer(
  res: Response,
  status: number,
  body: object,
  closeConnection: boolean
): void {
  if (res.headersSent || res.destroyed) return;
  if (closeConnection) {
    res.setHeader('Connection', 'close');
  }
  res.status(status).json(body);
}

export function refuseUnreadBody(
  req: Request,
  res: Response,
  status: number,
  body: object,
  limits: DrainLimits = DEFAULT_DRAIN_LIMITS
): void {
  if (!hasUnreadBody(req)) {
    answer(res, status, body, false);
    return;
  }
  if ((declaredLength(req) ?? 0) > limits.maxBytes) {
    answer(res, status, body, true);
    return;
  }

  let drained = 0;
  let settled = false;
  const settle = (respond: (() => void) | null) => {
    if (settled) return;
    settled = true;
    clearTimeout(timer);
    req.off('data', onData);
    req.off('end', onEnd);
    req.off('error', onGone);
    req.off('close', onGone);
    respond?.();
  };
  const cut = () =>
    settle(() => {
      req.pause();
      answer(res, status, body, true);
    });
  const onData = (chunk: Buffer) => {
    drained += chunk.length;
    if (drained > limits.maxBytes) cut();
  };
  const onEnd = () => settle(() => answer(res, status, body, false));
  const onGone = () => settle(null);
  const timer = setTimeout(cut, limits.maxMs);
  timer.unref();

  req.on('data', onData);
  req.once('end', onEnd);
  req.once('error', onGone);
  req.once('close', onGone);
}
