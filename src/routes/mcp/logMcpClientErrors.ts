import type { RequestHandler } from 'express';

import { sanitizeForLog } from '../../lib/log/sanitizeForLog';

const MAX_CAPTURED_BYTES = 4096;
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
  const methods = messages.map((message) => {
    const method = (message as { method?: unknown } | null)?.method;
    return typeof method === 'string' && PLAIN_METHOD_NAME.test(method)
      ? method
      : '?';
  });
  return methods.join(',');
}

function headerValue(value: string | string[] | undefined): string {
  if (value == null) {
    return '-';
  }
  return sanitizeForLog(Array.isArray(value) ? value.join(', ') : value);
}

function toBuffer(chunk: unknown): Buffer | null {
  if (typeof chunk === 'string') {
    return Buffer.from(chunk);
  }
  if (chunk instanceof Uint8Array) {
    return Buffer.from(chunk);
  }
  return null;
}

// /mcp answers some requests 4xx (a bad Accept header, an unsupported protocol
// version, a malformed batch) from inside the MCP SDK, which logs nothing. One
// line per refusal says why. It never carries request arguments, the error
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
      const buffer = toBuffer(chunk);
      if (buffer == null) {
        return;
      }
      const slice = buffer.subarray(0, MAX_CAPTURED_BYTES - capturedBytes);
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
          `[mcp] ${req.method} /mcp ${res.statusCode}`,
          `code=${sanitizeForLog(reason.code)}`,
          `message="${sanitizeForLog(reason.message)}"`,
          `method=${requestMethods(req.body)}`,
          `protocol=${headerValue(req.headers['mcp-protocol-version'])}`,
          `accept="${headerValue(req.headers.accept)}"`,
          `content_type="${headerValue(req.headers['content-type'])}"`,
        ].join(' ')
      );
    });
    next();
  };
}
