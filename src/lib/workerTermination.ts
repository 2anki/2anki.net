// The conversion process pool rejects in-flight tasks with this exact message
// when it force-drains on a graceful-shutdown timeout. The marker is matched by
// isWorkerTerminationError so callers (NotionController) mark the job
// 'interrupted' rather than 'failed' — the server restarted, the user retries.
export const WORKER_TERMINATION_MESSAGE = 'Terminating worker thread';

export function createWorkerTerminationError(): Error {
  return new Error(WORKER_TERMINATION_MESSAGE);
}

export function isWorkerTerminationError(err: unknown): boolean {
  return err instanceof Error && err.message === WORKER_TERMINATION_MESSAGE;
}

export const WORKER_INTERRUPTED_REASON =
  'The server restarted while converting this file. Upload it again to retry.';

// A conversion child that dies mid-task (OOM kill, segfault in Python/Chromium,
// an uncaught exception that exits the process) rejects its task with this so
// the pool can spawn a replacement and the caller can mark the job failed with a
// user-facing reason. A worker-thread crash used to leave the Notion job stuck
// in 'started' with no rejection at all.
export class ConversionChildCrashedError extends Error {
  readonly exitCode: number | null;

  readonly signal: NodeJS.Signals | null;

  readonly lastRssBytes: number | null;

  readonly childReason: string;

  constructor(params: {
    exitCode: number | null;
    signal: NodeJS.Signals | null;
    lastRssBytes: number | null;
    reason: string;
  }) {
    super(
      `Conversion process crashed (reason=${params.reason} exit=${params.exitCode ?? 'null'} signal=${params.signal ?? 'null'} rss=${params.lastRssBytes ?? 'unknown'})`
    );
    this.name = 'ConversionChildCrashedError';
    this.exitCode = params.exitCode;
    this.signal = params.signal;
    this.lastRssBytes = params.lastRssBytes;
    this.childReason = params.reason;
  }
}

export function isConversionChildCrashedError(
  err: unknown
): err is ConversionChildCrashedError {
  return err instanceof ConversionChildCrashedError;
}
