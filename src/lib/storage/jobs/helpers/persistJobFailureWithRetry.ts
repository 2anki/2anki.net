// When a conversion dies because Postgres itself went away (the quarterly
// unattended-upgrades restart is ~4 seconds of ECONNREFUSED), the failure
// WRITE dies with it and the job strands in a non-terminal status — locked
// behind the 15-minute staleness window with 409s on every retry click
// (#4178). The database is back in seconds, so a short retry lands the job in
// 'failed', which is immediately restartable with an honest reason.

const CONNECTION_ERROR_CODES = new Set([
  'ECONNREFUSED',
  'ECONNRESET',
  'ETIMEDOUT',
  'EAI_AGAIN',
  'EPIPE',
  // Postgres SQLSTATEs for a server going down / not yet accepting connections.
  '57P01',
  '57P02',
  '57P03',
]);

export function isConnectionClassError(error: unknown): boolean {
  if (error == null || typeof error !== 'object') return false;
  const code = (error as { code?: unknown }).code;
  return typeof code === 'string' && CONNECTION_ERROR_CODES.has(code);
}

const RETRY_DELAYS_MS = [5_000, 10_000, 15_000];

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function persistJobFailureWithRetry(
  write: () => Promise<unknown>,
  options: {
    sleepFn?: (ms: number) => Promise<void>;
    logContext?: string;
  } = {}
): Promise<void> {
  const doSleep = options.sleepFn ?? sleep;
  const logPrefix = options.logContext ?? '[conversion]';
  let lastError: unknown;
  for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
    try {
      await write();
      return;
    } catch (error) {
      lastError = error;
      if (
        !isConnectionClassError(error) ||
        attempt === RETRY_DELAYS_MS.length
      ) {
        throw error;
      }
      console.warn(
        `${logPrefix} failure write hit a connection error; retrying in ${RETRY_DELAYS_MS[attempt]}ms`
      );
      await doSleep(RETRY_DELAYS_MS[attempt]);
    }
  }
  throw lastError;
}
