import type { RequestHandler } from 'express';

import { sanitizeForLog } from '../../lib/log/sanitizeForLog';

const MAX_CAPTURED_BYTES = 4096;
const MAX_LOGGED_METHODS = 10;
const PLAIN_METHOD_NAME = /^[a-z][a-z0-9_/.-]{0,63}$/i;

interface ErrorReason {
  code: string;
  message: string;
}

function readErrorReason(body: string): ErrorReason {
  try {
    const parsed: unknown = JSON.parse(body);
    if (parsed == null || typeof parsed !== 'object') {
      return { code: '-', message: '-' };
    }
    const { error, error_description: description } = parsed as {
      error?: unknown;
      error_description?: unknown;
    };
    if (error != null && typeof error === 'object') {
      const { code, message } = error as { code?: unknown; message?: unknown };
      return { code: String(code ?? '-'), message: String(message ?? '-') };
    }
    return { code: String(error ?? '-'), message: String(description ?? '-') };
  } catch {
    return { code: '-', message: '-' };
  }
}

function requestMethods(body: unknown): string {
  const messages = Array.isArray(body) ? body : [body];
  const methods = messages.slice(0, MAX_LOGGED_METHODS).map((message) => {
    const method = (message as { method?: unknown } | null)?.method;
    return typeof method === 'string' && PLAIN_METHOD_NAME.test(method)
      ? method
      : '?';
  });
  const unlisted = messages.length - methods.length;
  return unlisted > 0 ? `${methods.join(',')},+${unlisted}` : methods.join(',');
}

function headerValue(value: string | string[] | undefined): string {
  if (value == null) {
    return '-';
  }
  return sanitizeForLog(Array.isArray(value) ? value.join(', ') : value);
}

function quoted(value: string): string {
  return JSON.stringify(value);
}

function leadingBytes(chunk: unknown, limit: number): Buffer | null {
  if (typeof chunk === 'string') {
    return Buffer.from(chunk.slice(0, limit)).subarray(0, limit);
  }
  if (chunk instanceof Uint8Array) {
    return Buffer.from(chunk.subarray(0, limit));
  }
  return null;
}

// POST /mcp answers some requests 4xx (a bad Accept header, an unsupported
// protocol version, a malformed batch) from inside the MCP SDK, which logs
// nothing. One line per refusal says why. It never carries request arguments, the error
// data the SDK attaches, or anything tied to the user: only the error code and
// message, the JSON-RPC method names and the negotiation headers.
export function logMcpClientErrors(
  log: (line: string) => void = console.warn
): RequestHandler {
  return (req, res, next) => {
    const captured: Buffer[] = [];
    let capturedBytes = 0;
    const capture = (chunk: unknown) => {
      if (res.statusCode < 400 || capturedBytes >= MAX_CAPTURED_BYTES) {
        return;
      }
      const slice = leadingBytes(chunk, MAX_CAPTURED_BYTES - capturedBytes);
      if (slice == null) {
        return;
      }
      captured.push(slice);
      capturedBytes += slice.length;
    };

    const write = res.write.bind(res) as (...args: unknown[]) => boolean;
    const end = res.end.bind(res) as (...args: unknown[]) => typeof res;
    res.write = ((...args: unknown[]) => {
      capture(args[0]);
      return write(...args);
    }) as typeof res.write;
    res.end = ((...args: unknown[]) => {
      if (typeof args[0] !== 'function') {
        capture(args[0]);
      }
      return end(...args);
    }) as typeof res.end;

    res.on('finish', () => {
      if (res.statusCode < 400 || res.statusCode >= 500) {
        return;
      }
      const reason = readErrorReason(Buffer.concat(captured).toString('utf8'));
      log(
        [
          `[mcp] POST /mcp ${res.statusCode}`,
          `code=${sanitizeForLog(reason.code)}`,
          `message=${quoted(sanitizeForLog(reason.message))}`,
          `method=${requestMethods(req.body)}`,
          `protocol=${headerValue(req.headers['mcp-protocol-version'])}`,
          `accept=${quoted(headerValue(req.headers.accept))}`,
          `content_type=${quoted(headerValue(req.headers['content-type']))}`,
        ].join(' ')
      );
    });
    next();
  };
}
