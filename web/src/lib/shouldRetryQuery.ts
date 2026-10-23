import { UserNotice } from './errors/UserNotice';

const MAX_RETRIES = 3;

// A UserNotice is the server's deliberate answer (Notion disconnected, a
// limit reached): asking again returns the same thing, so only network and
// server failures are retried.
export function shouldRetryQuery(
  failureCount: number,
  error: unknown
): boolean {
  if (error instanceof UserNotice) return false;
  return failureCount < MAX_RETRIES;
}
