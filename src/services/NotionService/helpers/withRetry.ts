import {
  APIErrorCode,
  APIResponseError,
  RequestTimeoutError,
  UnknownHTTPResponseError,
} from '@notionhq/client';
import axios from 'axios';

export interface WithRetryOptions {
  maxAttempts?: number;
  baseDelayMs?: number;
  label?: string;
  sleepFn?: (ms: number) => Promise<void>;
}

const RETRY_AFTER_MAX_MS = 30_000;

const RETRYABLE_NOTION_CODES = new Set<string>([
  APIErrorCode.RateLimited,
  APIErrorCode.InternalServerError,
  APIErrorCode.ServiceUnavailable,
  'gateway_timeout',
]);

const RETRYABLE_NETWORK_CODES = new Set<string>([
  'ECONNRESET',
  'ECONNREFUSED',
  'ETIMEDOUT',
  'EAI_AGAIN',
  'ENOTFOUND',
  'EPIPE',
  'UND_ERR_SOCKET',
  'UND_ERR_CONNECT_TIMEOUT',
  'UND_ERR_HEADERS_TIMEOUT',
]);

// Transient HTTP statuses the Notion client surfaces as UnknownHTTPResponseError
// (no known APIErrorCode) — gateway/upstream blips worth one more attempt.
const RETRYABLE_HTTP_STATUSES = new Set<number>([429, 500, 502, 503, 504]);

function isRetryableAxiosError(error: unknown): boolean {
  if (!axios.isAxiosError(error)) {
    return false;
  }
  if (error.response == null) {
    return true;
  }
  return RETRYABLE_HTTP_STATUSES.has(error.response.status);
}

function isRetryable(error: unknown, depth = 0): boolean {
  if (error instanceof APIResponseError) {
    return RETRYABLE_NOTION_CODES.has(error.code);
  }
  if (RequestTimeoutError.isRequestTimeoutError(error)) {
    return true;
  }
  if (UnknownHTTPResponseError.isUnknownHTTPResponseError(error)) {
    return RETRYABLE_HTTP_STATUSES.has(error.status);
  }
  if (isRetryableAxiosError(error)) {
    return true;
  }
  const code = (error as { code?: string })?.code;
  if (typeof code === 'string' && RETRYABLE_NETWORK_CODES.has(code)) {
    return true;
  }
  // Node's native fetch reports undici failures as a generic
  // TypeError('fetch failed') with the real code on `cause` — a connect
  // timeout sat unretried here for exactly that reason (#4175).
  const cause = (error as { cause?: unknown })?.cause;
  if (cause != null && depth < 2) {
    return isRetryable(cause, depth + 1);
  }
  return false;
}

function describeFailure(error: unknown): string {
  if (axios.isAxiosError(error)) {
    if (typeof error.response?.status === 'number') {
      return `status ${error.response.status}`;
    }
    const code = typeof error.code === 'string' ? error.code : '';
    if (/^[A-Z0-9_]+$/.test(code)) {
      return `code ${code}`;
    }
    return 'network error';
  }
  if (error instanceof Error) {
    return error.constructor.name;
  }
  return 'unknown';
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseRetryAfterMs(error: unknown): number | null {
  if (!(error instanceof APIResponseError)) {
    return null;
  }
  const raw = (error.headers as Record<string, string> | undefined)?.[
    'retry-after'
  ];
  if (!raw) {
    return null;
  }
  const seconds = Number.parseInt(raw, 10);
  if (!Number.isFinite(seconds) || seconds <= 0) {
    return null;
  }
  return Math.min(seconds * 1000, RETRY_AFTER_MAX_MS);
}

export async function withRetry<T>(
  operation: () => Promise<T>,
  options: WithRetryOptions = {}
): Promise<T> {
  const maxAttempts = options.maxAttempts ?? 3;
  const baseDelayMs = options.baseDelayMs ?? 500;
  const label = options.label;
  const doSleep = options.sleepFn ?? sleep;

  let lastError: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if (attempt === maxAttempts || !isRetryable(error)) {
        throw error;
      }
      const retryAfterMs = parseRetryAfterMs(error);
      const jitter = 0.5 + Math.random();
      const delay =
        retryAfterMs ?? Math.floor(baseDelayMs * 2 ** (attempt - 1) * jitter);
      const labelSuffix = label ? `:${label}` : '';
      console.warn(
        `[withRetry${labelSuffix}] attempt ${attempt}/${maxAttempts} failed (${describeFailure(error)}); retrying in ${delay}ms`
      );
      await doSleep(delay);
    }
  }
  throw lastError;
}
