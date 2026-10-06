import { writeFallbackError } from './errorFallback';
import {
  ChildToParentMessage,
  ParentToChildMessage,
  serializeTaskError,
} from './conversionChildProtocol';

export const CHILD_HEARTBEAT_INTERVAL_MS = 15_000;

interface IntervalHandle {
  unref?: () => unknown;
}

export interface ChildRuntimeDeps {
  // Runs one task and resolves with the value to return to the parent. The child
  // entry wires the real conversion/upload handlers; the test fixture wires its
  // own. The runtime is deliberately payload-agnostic.
  handle: (
    payload: unknown,
    onProgress: (step: string) => void
  ) => Promise<unknown>;
  // Drains the events sink and destroys the DB pool before the child exits, so a
  // billable usage row is never lost and no connection is stranded.
  onRetire?: () => Promise<void>;
  proc?: NodeJS.Process;
  heartbeatIntervalMs?: number;
  setIntervalFn?: (cb: () => void, ms: number) => IntervalHandle;
}

function toMemorySample(usage: NodeJS.MemoryUsage) {
  return {
    rss: usage.rss,
    heapTotal: usage.heapTotal,
    heapUsed: usage.heapUsed,
    external: usage.external,
    arrayBuffers: usage.arrayBuffers,
  };
}

export function startChild(deps: ChildRuntimeDeps): void {
  const proc = deps.proc ?? process;
  const send = (message: ChildToParentMessage): void => {
    proc.send?.(message);
  };

  // pm2 treekills descendants on a cutover, so the child would get SIGINT/SIGTERM
  // too. Ignoring them lets the parent drive the lifecycle: the child exits on an
  // explicit retire message or when the IPC channel disconnects (parent gone).
  proc.on('SIGINT', () => {});
  proc.on('SIGTERM', () => {});

  let exiting = false;
  const gracefulExit = async (code: number): Promise<void> => {
    if (exiting) return;
    exiting = true;
    try {
      await deps.onRetire?.();
    } catch (err) {
      console.error('[conversion-child] retire drain failed', err);
    }
    proc.exit(code);
  };

  proc.on('disconnect', () => {
    void gracefulExit(0);
  });

  proc.on('uncaughtException', (err: Error) => {
    writeFallbackError({
      source: 'conversion-child',
      message: err?.message ?? String(err),
      stack: err?.stack,
      capturedAt: new Date().toISOString(),
      phase: 'uncaught',
    });
    console.error('[conversion-child] uncaught exception', err);
    proc.exit(1);
  });

  const heartbeat = (): void => {
    send({ kind: 'heartbeat', memory: toMemorySample(proc.memoryUsage()) });
  };
  const scheduleInterval =
    deps.setIntervalFn ?? ((cb, ms) => setInterval(cb, ms));
  const timer = scheduleInterval(
    heartbeat,
    deps.heartbeatIntervalMs ?? CHILD_HEARTBEAT_INTERVAL_MS
  );
  timer.unref?.();

  const runTask = async (taskId: number, payload: unknown): Promise<void> => {
    const onProgress = (step: string): void => {
      send({ kind: 'progress', taskId, step });
    };
    try {
      const value = await deps.handle(payload, onProgress);
      send({
        kind: 'result',
        taskId,
        rssBytes: proc.memoryUsage().rss,
        value,
      });
    } catch (err) {
      send({
        kind: 'error',
        taskId,
        rssBytes: proc.memoryUsage().rss,
        error: serializeTaskError(err),
      });
    }
  };

  proc.on('message', (raw: unknown) => {
    const message = raw as ParentToChildMessage;
    if (message?.kind === 'retire') {
      void gracefulExit(0);
      return;
    }
    if (message?.kind === 'task') {
      void runTask(message.taskId, message.payload);
    }
  });

  send({ kind: 'ready' });
}
