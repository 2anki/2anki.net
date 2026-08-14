// Piscina rejects in-flight tasks with `Error('Terminating worker thread')`
// when a pool is destroyed (recycle drain timeout, graceful shutdown). The
// class behind it is created by a factory and not exported at runtime, so the
// message is the stable marker across piscina versions (piscina/src/errors.ts).
export function isWorkerTerminationError(err: unknown): boolean {
  return err instanceof Error && err.message === 'Terminating worker thread';
}

export const WORKER_INTERRUPTED_REASON =
  'The server restarted while converting this file. Upload it again to retry.';
