import {
  formatMemoryUsageLine,
  MEMORY_USAGE_LOG_INTERVAL_MS,
  scheduleMemoryUsageLog,
} from './scheduleMemoryUsageLog';

const MB = 1024 * 1024;

const memory = {
  rss: 1200 * MB,
  heapTotal: 300 * MB,
  heapUsed: 250 * MB,
  external: 700 * MB,
  arrayBuffers: 650 * MB,
};

describe('formatMemoryUsageLine', () => {
  it('breaks memory out in megabytes with the pool state', () => {
    expect(
      formatMemoryUsageLine(memory, {
        queueSize: 2,
        threads: 4,
        utilization: 0.5,
      })
    ).toBe(
      '[memory] rss_mb=1200 heap_total_mb=300 heap_used_mb=250 external_mb=700 array_buffers_mb=650 pool_threads=4 pool_queue=2 pool_utilization=0.5'
    );
  });

  it('omits the pool fields before the pool exists', () => {
    expect(formatMemoryUsageLine(memory, null)).toBe(
      '[memory] rss_mb=1200 heap_total_mb=300 heap_used_mb=250 external_mb=700 array_buffers_mb=650'
    );
  });
});

describe('scheduleMemoryUsageLog', () => {
  function setup() {
    const lines: string[] = [];
    const scheduled: { tick?: () => void; ms?: number; unrefs: number } = {
      unrefs: 0,
    };
    const handle = scheduleMemoryUsageLog({
      sampleMemory: () => memory,
      samplePool: () => null,
      log: (line) => lines.push(line),
      setIntervalFn: (tick, ms) => {
        scheduled.tick = tick;
        scheduled.ms = ms;
        return {
          unref: () => {
            scheduled.unrefs += 1;
          },
        };
      },
    });
    return { lines, scheduled, handle };
  }

  it('logs once a minute and never keeps the process alive', () => {
    const { lines, scheduled } = setup();

    expect(scheduled.ms).toBe(MEMORY_USAGE_LOG_INTERVAL_MS);
    expect(scheduled.unrefs).toBe(1);
    expect(lines).toEqual([]);
  });

  it('writes one line per tick', () => {
    const { lines, scheduled } = setup();

    scheduled.tick?.();
    scheduled.tick?.();

    expect(lines).toEqual([
      formatMemoryUsageLine(memory, null),
      formatMemoryUsageLine(memory, null),
    ]);
  });
});
