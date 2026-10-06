import { fork } from 'node:child_process';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import {
  ConversionProcessPool,
  ForkFn,
  PooledChild,
} from './conversionProcessPool';
import { ConversionChildCrashedError } from './workerTermination';

jest.setTimeout(60_000);

const fixturePath = path.join(
  __dirname,
  '../test/fixtures/conversionChildFixture.ts'
);

const realFork: ForkFn = (modulePath, args, options) =>
  fork(modulePath, args, options) as unknown as PooledChild;

function makeRealPool(maxChildren = 2) {
  return new ConversionProcessPool({
    forkFn: realFork,
    childModulePath: fixturePath,
    childExecArgv: ['--require', 'tsx/cjs'],
    childEnv: { ...process.env },
    maxChildren,
    recycleTasks: 1_000,
    retireRssBytes: 8_000_000_000,
    guardRssBytes: 16_000_000_000,
    killGraceMs: 2_000,
    rssPollMs: 60_000,
  });
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function waitUntil(
  predicate: () => boolean,
  budgetMs = 5_000,
  stepMs = 100
): Promise<boolean> {
  const deadline = Date.now() + budgetMs;
  while (Date.now() < deadline) {
    if (predicate()) return true;
    await delay(stepMs);
  }
  return predicate();
}

describe('conversion child (real fork)', () => {
  let pool: ConversionProcessPool;

  beforeAll(() => {
    pool = makeRealPool();
    pool.start();
  });

  afterAll(async () => {
    await pool.shutdown(5_000);
  });

  it('round-trips a Buffer through advanced IPC serialization', async () => {
    const result = await pool.runTask({
      type: 'echo',
      value: Buffer.from('hello-bytes'),
    });
    expect(Buffer.isBuffer(result)).toBe(true);
    expect((result as Buffer).toString()).toBe('hello-bytes');
  });

  it('round-trips an object instance as plain data', async () => {
    class Sample {
      constructor(
        readonly a: number,
        readonly b: string
      ) {}
    }
    const result = await pool.runTask({
      type: 'echo',
      value: new Sample(7, 'x'),
    });
    expect(result).toEqual({ a: 7, b: 'x' });
  });

  it('delivers progress steps in order over IPC', async () => {
    const steps: string[] = [];
    const result = await pool.runTask(
      { type: 'progress', value: 'done', steps: ['one', 'two', 'three'] },
      (step) => steps.push(step)
    );
    expect(steps).toEqual(['one', 'two', 'three']);
    expect(result).toBe('done');
  });

  it('rejects a crashed task and recovers for the next one', async () => {
    await expect(pool.runTask({ type: 'crash' })).rejects.toBeInstanceOf(
      ConversionChildCrashedError
    );
    const recovered = await pool.runTask({
      type: 'echo',
      value: 'after-crash',
    });
    expect(recovered).toBe('after-crash');
  });
});

describe('conversion child process-group kill', () => {
  it('reaps a spawned grandchild when the group is force-killed', async () => {
    const pool = makeRealPool(1);
    pool.start();
    const grandchildPid = (await pool.runTask({
      type: 'spawn-grandchild',
    })) as number;
    expect(typeof grandchildPid).toBe('number');
    expect(isAlive(grandchildPid)).toBe(true);

    // Keep the child busy so the drain cannot complete gracefully; the timeout
    // forces a process-group SIGKILL, which must take the grandchild with it.
    pool.runTask({ type: 'hang' }).catch(() => {});
    await pool.shutdown(500);

    const reaped = await waitUntil(() => !isAlive(grandchildPid), 8_000);
    expect(reaped).toBe(true);
  });
});
