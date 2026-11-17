import type { Response } from 'express';

// Aborts when the connection closes before the answer was sent, so work
// still waiting to start on this request's behalf can be skipped.
export function clientGoneSignal(res: Response): AbortSignal {
  const controller = new AbortController();
  res.once('close', () => {
    if (!res.writableEnded) controller.abort();
  });
  return controller.signal;
}
