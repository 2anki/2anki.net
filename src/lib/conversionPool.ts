import path from 'node:path';
import fs from 'node:fs';
import type { Transferable } from 'node:worker_threads';
import Piscina from 'piscina';
import knex, { Knex } from 'knex';
import {
  UPLOAD_GENERATION_TASK,
  UploadGenerationResult,
  UploadGenerationTask,
} from '../usecases/uploads/uploadGenerationTypes';
import performConversion from './storage/jobs/helpers/performConversion';
import NotionAPIWrapper from '../services/NotionService/NotionAPIWrapper';
import NotionRepository from '../data_layer/NotionRespository';
import BlocksCacheRepository from '../data_layer/BlocksCacheRepository';
import JobRepository from '../data_layer/JobRepository';
import { SetJobFailedUseCase } from '../usecases/jobs/SetJobFailedUseCase';
import { NOTION_TOKEN_EXPIRED_REASON } from '../usecases/jobs/jobFailureReason';
import {
  resolveConversionWorkers,
  resolveConversionWorkerRecycleTasks,
} from './pythonWorkerBudget';
import { MAX_OLD_GENERATION_SIZE_MB } from './conversionMemoryLimits';

export { resolveConversionWorkers } from './pythonWorkerBudget';

export interface ConversionWorkerRequest {
  id: string;
  owner: string;
  isPaying: boolean;
  type?: string;
  title: string;
  jobDbId: string | number;
  frontField?: string;
  backField?: string;
  anonId?: string;
  signupOrigin?: string | null;
}

let pool: Piscina | null = null;

export const POOL_CLOSE_TIMEOUT_MS = 80_000;

// Piscina workers are a lifetime singleton, so each worker's V8 old-gen heap
// ratchets up across conversions (large Notion decks hold image/PDF buffers and
// rendered HTML) and never resets without a deploy — prod saw RSS climb 317MB →
// 1.4GB over 20h on one process. Recycling the pool after a bounded number of
// completed tasks drains the old workers and starts fresh ones, so the heap
// resets periodically instead of only on restart. The old-gen cap stays at
// 1024MB: lowering it risks OOMing the comprehensive/big-media path (which would
// turn a slow leak into failed conversions), so recycling — not a smaller cap —
// is the mechanism that bounds RSS. The cap value lives in
// conversionMemoryLimits.ts so the zip extractor can size its ceilings under it
// without importing this heavy module (knex, Piscina, the Notion client).
export { MAX_OLD_GENERATION_SIZE_MB };

let completedTaskCount = 0;
let recyclingPool = false;

export function shouldRecyclePool(
  completedTasks: number,
  recycleThreshold: number,
  isRecycling: boolean
): boolean {
  return !isRecycling && completedTasks >= recycleThreshold;
}

export function resetConversionPoolForTesting(): void {
  pool = null;
  completedTaskCount = 0;
  recyclingPool = false;
}

function workerEntry(): { filename: string; execArgv: string[] } {
  const tsPath = path.resolve(__dirname, './conversionWorker.ts');
  const jsPath = path.resolve(__dirname, './conversionWorker.js');
  const filename = fs.existsSync(tsPath) ? tsPath : jsPath;
  const execArgv = filename.endsWith('.ts') ? ['--require', 'tsx/cjs'] : [];
  return { filename, execArgv };
}

export function initConversionPool(): Piscina {
  if (pool) return pool;
  const { filename, execArgv } = workerEntry();
  const maxThreads = resolveConversionWorkers();
  pool = new Piscina({
    filename,
    execArgv,
    maxThreads,
    minThreads: 1,
    resourceLimits: { maxOldGenerationSizeMb: MAX_OLD_GENERATION_SIZE_MB },
    closeTimeout: POOL_CLOSE_TIMEOUT_MS,
  });
  return pool;
}

export function getConversionPool(): Piscina {
  return initConversionPool();
}

export function describeConversionPool(): {
  queueSize: number;
  threads: number;
  utilization: number;
} | null {
  if (pool == null) return null;
  return {
    queueSize: pool.queueSize,
    threads: pool.threads.length,
    utilization: Number(pool.utilization.toFixed(2)),
  };
}

// Swap in a fresh pool and drain the retiring one in the background so heaps
// reset without dropping in-flight conversions — close() waits for outstanding
// tasks up to its budget. Guarded against re-entry so a burst of completions
// past the threshold cannot start overlapping recycles.
function recycleConversionPool(): void {
  const retiring = pool;
  if (recyclingPool || retiring == null) return;
  recyclingPool = true;
  completedTaskCount = 0;
  pool = null;
  initConversionPool();
  void shutdownConversionPool({
    handle: retiring,
    timeoutMs: POOL_CLOSE_TIMEOUT_MS + 3_000,
  })
    .catch((error) => {
      console.error('Conversion pool recycle drain failed:', error);
    })
    .finally(() => {
      recyclingPool = false;
    });
}

function noteTaskCompleted(): void {
  completedTaskCount += 1;
  if (
    shouldRecyclePool(
      completedTaskCount,
      resolveConversionWorkerRecycleTasks(),
      recyclingPool
    )
  ) {
    recycleConversionPool();
  }
}

export async function runConversion(
  request: ConversionWorkerRequest
): Promise<void> {
  try {
    await getConversionPool().run(request);
  } finally {
    noteTaskCompleted();
  }
}

export async function runUploadGeneration(
  task: UploadGenerationTask,
  transferList?: Transferable[]
): Promise<UploadGenerationResult> {
  try {
    return await getConversionPool().run(task, {
      name: UPLOAD_GENERATION_TASK,
      transferList: transferList as never, // piscina's TransferList type misinfers to StructuredSerializeOptions under lib.dom; the runtime expects an array
    });
  } finally {
    noteTaskCompleted();
  }
}

export async function shutdownConversionPool(
  options: { timeoutMs?: number; handle?: Piscina } = {}
): Promise<void> {
  const handle = options.handle ?? pool;
  if (handle == null) return;
  if (handle === pool) pool = null;
  const drain = handle.close();
  if (options.timeoutMs == null) {
    await drain;
    return;
  }
  const timeout = new Promise<'timeout'>((resolve) => {
    const t = setTimeout(() => resolve('timeout'), options.timeoutMs);
    t.unref();
  });
  const winner = await Promise.race([
    drain.then(() => 'drained' as const),
    timeout,
  ]);
  if (winner === 'timeout') {
    console.error(
      `Conversion pool did not drain within ${options.timeoutMs}ms — ` +
        `forcing destroy, dropping ${handle.queueSize} queued conversion(s)`
    );
    await handle.destroy();
  }
}

let workerKnex: Knex | null = null;

function defaultKnexFactory(): Knex {
  if (workerKnex) return workerKnex;
  workerKnex = knex({
    client: 'pg',
    connection: process.env.DATABASE_URL,
    pool: { min: 0, max: 2 },
  });
  return workerKnex;
}

export async function runConversionInWorker(
  request: ConversionWorkerRequest,
  knexFactory: () => Knex = defaultKnexFactory
): Promise<void> {
  const database = knexFactory();
  const notionRepo = new NotionRepository(database);
  const token = await notionRepo.getNotionToken(request.owner);
  if (token == null) {
    const jobRepo = new JobRepository(database);
    const setJobFailed = new SetJobFailedUseCase(jobRepo);
    await setJobFailed.execute(
      request.id,
      request.owner,
      NOTION_TOKEN_EXPIRED_REASON
    );
    return;
  }
  const blocksCache = new BlocksCacheRepository(database);
  const api = new NotionAPIWrapper(token, request.owner, blocksCache);
  await performConversion(database, {
    api,
    id: request.id,
    owner: request.owner,
    isPaying: request.isPaying,
    type: request.type,
    title: request.title,
    jobDbId: request.jobDbId,
    frontField: request.frontField,
    backField: request.backField,
    anonId: request.anonId,
    signupOrigin: request.signupOrigin,
  });
}
