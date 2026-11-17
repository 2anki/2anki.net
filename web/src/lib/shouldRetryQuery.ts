import { UserNotice } from './errors/UserNotice';

const MAX_RETRIES = 3;
const RETRYABLE_CLIENT_STATUSES = new Set([408, 429]);

function statusOf(error: unknown): number | undefined {
  if (error == null || typeof error !== 'object') return undefined;
  const { status } = error as { status?: unknown };
  return typeof status === 'number' ? status : undefined;
}

export function isFinalRefusal(error: unknown): boolean {
  const status = statusOf(error);
  if (status == null || status < 400 || status >= 500) return false;
  return !RETRYABLE_CLIENT_STATUSES.has(status);
}

// A UserNotice or a 4xx is the server's deliberate answer (Notion
// disconnected, a limit reached, a deck too large): asking again returns the
// same thing, so only network failures, timeouts, rate limits and server
// errors are retried.
export function shouldRetryQuery(
  failureCount: number,
  error: unknown
): boolean {
  if (error instanceof UserNotice) return false;
  if (isFinalRefusal(error)) return false;
  return failureCount < MAX_RETRIES;
}
