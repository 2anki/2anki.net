import type { ConversionWorkerRequest } from './conversionRequestTypes';
import type {
  UploadGenerationResult,
  UploadGenerationTask,
} from '../usecases/uploads/uploadGenerationTypes';

// A conversion runs in a forked child process. Messages cross the IPC channel
// with v8 advanced serialization, so Buffers survive but class prototypes do
// not — every payload here is plain data, and results are read for their fields
// (card counts, paths), never their methods, exactly as the thread pool did.

export interface ChildMemorySample {
  rss: number;
  heapTotal: number;
  heapUsed: number;
  external: number;
  arrayBuffers: number;
}

export interface SerializedTaskError {
  message: string;
  name?: string;
  code?: string;
  sourceFormat?: 'markdown';
  // Plain values an error carries for its answer (a page range's reason and
  // page numbers); nested objects and functions are dropped.
  details?: Record<string, string | number>;
}

const MAX_DETAIL_KEYS = 8;

function plainDetails(
  value: unknown
): Record<string, string | number> | undefined {
  if (value == null || typeof value !== 'object' || Array.isArray(value)) {
    return undefined;
  }
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(
      (entry): entry is [string, string | number] =>
        typeof entry[1] === 'string' || typeof entry[1] === 'number'
    )
    .slice(0, MAX_DETAIL_KEYS);
  return entries.length === 0 ? undefined : Object.fromEntries(entries);
}

// The scheduler is payload-agnostic: it routes by taskId and resolves with
// whatever the child returns. Only the child runtime reads the discriminant.
export type ConversionChildTaskPayload =
  | { type: 'conversion'; request: ConversionWorkerRequest }
  | { type: 'upload'; task: UploadGenerationTask };

export type ParentToChildMessage =
  | { kind: 'task'; taskId: number; payload: unknown }
  | { kind: 'retire' };

export type ChildToParentMessage =
  | { kind: 'ready' }
  | { kind: 'progress'; taskId: number; step: string }
  | { kind: 'result'; taskId: number; rssBytes: number; value: unknown }
  | {
      kind: 'error';
      taskId: number;
      rssBytes: number;
      error: SerializedTaskError;
    }
  | { kind: 'heartbeat'; memory: ChildMemorySample };

export function serializeTaskError(err: unknown): SerializedTaskError {
  if (err instanceof Error) {
    const withCode = err as Error & {
      code?: unknown;
      sourceFormat?: unknown;
      details?: unknown;
    };
    return {
      message: err.message,
      name: err.name,
      code: typeof withCode.code === 'string' ? withCode.code : undefined,
      sourceFormat:
        withCode.sourceFormat === 'markdown' ? 'markdown' : undefined,
      details: plainDetails(withCode.details),
    };
  }
  return { message: String(err) };
}

export function rebuildTaskError(error: SerializedTaskError): Error {
  const rebuilt = new Error(error.message) as Error & {
    code?: string;
    sourceFormat?: 'markdown';
    details?: Record<string, string | number>;
  };
  if (error.name != null) rebuilt.name = error.name;
  if (error.code != null) rebuilt.code = error.code;
  if (error.sourceFormat != null) rebuilt.sourceFormat = error.sourceFormat;
  if (error.details != null) rebuilt.details = error.details;
  return rebuilt;
}

export type { UploadGenerationResult };
