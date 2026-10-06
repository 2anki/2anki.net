export const MEMORY_USAGE_LOG_INTERVAL_MS = 60 * 1000;

const BYTES_PER_MB = 1024 * 1024;

type MemorySample = Pick<
  NodeJS.MemoryUsage,
  'rss' | 'heapTotal' | 'heapUsed' | 'external' | 'arrayBuffers'
>;

interface PoolSample {
  queueSize: number;
  threads: number;
  utilization: number;
}

interface IntervalHandle {
  unref(): unknown;
}

interface MemoryUsageLogDeps<H extends IntervalHandle> {
  sampleMemory?: () => MemorySample;
  samplePool: () => PoolSample | null;
  log?: (line: string) => void;
  setIntervalFn: (tick: () => void, ms: number) => H;
  intervalMs?: number;
}

const toMb = (bytes: number) => Math.round(bytes / BYTES_PER_MB);

export function formatMemoryUsageLine(
  memory: MemorySample,
  pool: PoolSample | null
): string {
  const fields = [
    `rss_mb=${toMb(memory.rss)}`,
    `heap_total_mb=${toMb(memory.heapTotal)}`,
    `heap_used_mb=${toMb(memory.heapUsed)}`,
    `external_mb=${toMb(memory.external)}`,
    `array_buffers_mb=${toMb(memory.arrayBuffers)}`,
  ];
  if (pool != null) {
    fields.push(
      `pool_threads=${pool.threads}`,
      `pool_queue=${pool.queueSize}`,
      `pool_utilization=${pool.utilization}`
    );
  }
  return `[memory] ${fields.join(' ')}`;
}

export function scheduleMemoryUsageLog<H extends IntervalHandle>(
  deps: MemoryUsageLogDeps<H>
): H {
  const sampleMemory = deps.sampleMemory ?? (() => process.memoryUsage());
  const log = deps.log ?? ((line: string) => console.info(line));
  const handle = deps.setIntervalFn(() => {
    log(formatMemoryUsageLine(sampleMemory(), deps.samplePool()));
  }, deps.intervalMs ?? MEMORY_USAGE_LOG_INTERVAL_MS);
  handle.unref();
  return handle;
}
