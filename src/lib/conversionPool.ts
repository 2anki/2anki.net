import { fork } from 'node:child_process';
import type {
  UploadGenerationResult,
  UploadGenerationTask,
} from '../usecases/uploads/uploadGenerationTypes';
import {
  resolveConversionWorkers,
  resolveConversionWorkerRecycleTasks,
} from './pythonWorkerBudget';
import {
  MAX_OLD_GENERATION_SIZE_MB,
  CONVERSION_CHILD_RETIRE_RSS_MB,
  CONVERSION_CHILD_GUARD_RSS_MB,
} from './conversionMemoryLimits';
import {
  ConversionProcessPool,
  ForkFn,
  PooledChild,
  buildChildEnv,
  resolveConversionChildEntry,
} from './conversionProcessPool';
import { pinConversionTaskInput } from './conversionTaskInput';
import { createWorkerTerminationError } from './workerTermination';
import type { ConversionWorkerRequest } from './conversionRequestTypes';

export { resolveConversionWorkers } from './pythonWorkerBudget';
export type { ConversionWorkerRequest } from './conversionRequestTypes';

// Sits above the slowest legitimate conversion so a graceful shutdown lets a
// large Notion deck finish instead of being force-killed at the blue-green swap;
// gracefulShutdown adds a small reserve on top for the trailing DB teardown.
export const POOL_CLOSE_TIMEOUT_MS = 80_000;

// Conversions run in a pool of forked child processes that exit when they
// retire, so whatever a conversion leaks (glibc arenas, native buffers,
// ratcheted V8 old-gen) goes back to the OS at the process boundary — the one
// guarantee a lifetime worker-thread pool could not give. The V8 old-gen cap is
// re-exported for the zip extractor to size its ceilings under.
export { MAX_OLD_GENERATION_SIZE_MB };

let pool: ConversionProcessPool | null = null;
let shuttingDown = false;

const BYTES_PER_MB = 1024 * 1024;

const defaultForkFn: ForkFn = (modulePath, args, options) =>
  fork(modulePath, args, options) as unknown as PooledChild;

export function resetConversionPoolForTesting(): void {
  pool = null;
  shuttingDown = false;
}

export function initConversionPool(): ConversionProcessPool {
  if (pool) return pool;
  const entry = resolveConversionChildEntry(__filename);
  pool = new ConversionProcessPool({
    forkFn: defaultForkFn,
    childModulePath: entry.filename,
    childExecArgv: entry.execArgv,
    childEnv: buildChildEnv(process.env),
    maxChildren: resolveConversionWorkers(),
    recycleTasks: resolveConversionWorkerRecycleTasks(),
    retireRssBytes: CONVERSION_CHILD_RETIRE_RSS_MB * BYTES_PER_MB,
    guardRssBytes: CONVERSION_CHILD_GUARD_RSS_MB * BYTES_PER_MB,
  });
  pool.start();
  return pool;
}

// Once the drain has begun, work that has not reached the pool yet is refused
// with the same error the drain timeout uses, so callers mark the job
// interrupted and the user retries on the new color. Letting it through would
// start a fresh pool nobody drains, with children the exit then orphans.
export function getConversionPool(): ConversionProcessPool {
  if (shuttingDown) throw createWorkerTerminationError();
  return initConversionPool();
}

export function describeConversionPool(): {
  queueSize: number;
  threads: number;
  utilization: number;
  children: number;
  childrenRssMb: number;
  busyBackground: number;
  queuedInteractive: number;
  oldestInteractiveWaitMs: number;
} | null {
  if (pool == null) return null;
  return pool.describe();
}

export async function runConversion(
  request: ConversionWorkerRequest
): Promise<void> {
  await getConversionPool().runTask(
    { type: 'conversion', request },
    undefined,
    { kind: 'background', owner: String(request.owner) }
  );
}

export async function runUploadGeneration(
  task: UploadGenerationTask,
  onProgress?: (step: string) => void
): Promise<UploadGenerationResult> {
  // Pin each uploaded file onto disk off the hot IPC path so nothing is copied
  // into the child over the channel, then remove the directory once the child
  // has finished reading it (success or crash).
  const pinned = await pinConversionTaskInput(task);
  try {
    const value = await getConversionPool().runTask(
      { type: 'upload', task: pinned.task },
      onProgress
    );
    return value as UploadGenerationResult;
  } finally {
    await pinned.cleanup();
  }
}

export async function shutdownConversionPool(
  options: { timeoutMs?: number } = {}
): Promise<void> {
  shuttingDown = true;
  if (pool == null) return;
  const handle = pool;
  try {
    await handle.shutdown(options.timeoutMs);
  } finally {
    if (pool === handle) pool = null;
  }
}
