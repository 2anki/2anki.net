import { createHash } from 'node:crypto';
import type { IncomingHttpHeaders } from 'node:http';

// An anonymous sync upload exists only as the response body, so a dropped
// connection used to lose the deck (#4651). The finished apkg is copied here
// under a key only the uploading browser can rebuild: its anon_id cookie plus
// a random per-upload token the client sends and keeps. The key is a hash, so
// neither value can steer the storage path. The prefix is reserved from the
// dangling-object sweep (every object here is unreferenced by design, and a
// day of them would trip its volume alarm) and has its own 24h sweep.
export const ANON_RECOVERY_PREFIX = 'recover/';
export const ANON_RECOVERY_RETENTION_MS = 24 * 60 * 60 * 1000;
export const RECOVERY_TOKEN_HEADER = 'x-recovery-token';

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isRecoveryToken(value: unknown): value is string {
  return typeof value === 'string' && UUID_PATTERN.test(value);
}

export function anonRecoveryKey(anonId: string, token: string): string {
  const digest = createHash('sha256')
    .update(`${anonId}:${token.toLowerCase()}`)
    .digest('hex');
  return `${ANON_RECOVERY_PREFIX}${digest}.apkg`;
}

export function readRecoveryToken(headers: IncomingHttpHeaders): string | null {
  const value = headers[RECOVERY_TOKEN_HEADER];
  return isRecoveryToken(value) ? value : null;
}
