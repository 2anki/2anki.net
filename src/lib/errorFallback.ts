import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { IErrorEventRepository } from '../data_layer/ErrorEventRepository';

const FALLBACK_FILENAME = 'error-fallback.jsonl';

export interface FallbackErrorPayload {
  source: 'server' | 'conversion-child';
  message: string;
  stack?: string;
  release?: string;
  capturedAt: string;
  phase: 'startup' | 'uncaught' | 'unhandled-rejection' | 'db-outage';
}

function resolveLogsDir(logsDir?: string): string {
  return logsDir ?? path.join(process.cwd(), 'logs');
}

function sha256(value: string): string {
  return crypto.createHash('sha256').update(value).digest('hex');
}

export function writeFallbackError(
  payload: FallbackErrorPayload,
  logsDir?: string
): void {
  try {
    const dir = resolveLogsDir(logsDir);
    fs.mkdirSync(dir, { recursive: true });
    const line = JSON.stringify(payload) + '\n';
    fs.appendFileSync(path.join(dir, FALLBACK_FILENAME), line, 'utf8');
  } catch {
    // Never throw — best-effort sync append
  }
}

export async function drainFallbackFile(
  repository: IErrorEventRepository,
  logsDir?: string
): Promise<number> {
  const dir = resolveLogsDir(logsDir);
  const filePath = path.join(dir, FALLBACK_FILENAME);

  if (!fs.existsSync(filePath)) {
    return 0;
  }

  const content = fs.readFileSync(filePath, 'utf8');
  const lines = content.split('\n').filter((l) => l.trim().length > 0);

  if (lines.length === 0) {
    return 0;
  }

  let inserted = 0;
  for (const line of lines) {
    try {
      const payload = JSON.parse(line) as FallbackErrorPayload;
      await repository.insert({
        // error_events.source is CHECK-constrained to web|server; a conversion
        // child is a server-side process, and its "[conversion-child]" message
        // prefix already identifies the origin.
        source:
          payload.source === 'conversion-child' ? 'server' : payload.source,
        message: payload.message,
        message_hash: sha256(payload.message),
        stack: payload.stack ?? null,
        release: payload.release ?? null,
        url: null,
        ip_hash: null,
        user_id: null,
      });
      inserted++;
    } catch {
      console.error(
        '[errorFallback] skipping malformed fallback line:',
        line.slice(0, 120)
      );
    }
  }

  fs.writeFileSync(filePath, '', 'utf8');
  return inserted;
}
