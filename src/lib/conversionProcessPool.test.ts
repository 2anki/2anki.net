import { vi } from 'vitest';
import { EventEmitter } from 'node:events';
import {
  ConversionProcessPool,
  ForkFn,
  PooledChild,
  ProcessPoolDeps,
  buildChildEnv,
  resolveConversionChildEntry,
} from './conversionProcessPool';
import {
  ChildMemorySample,
  ParentToChildMessage,
  SerializedTaskError,
} from './conversionChildProtocol';
import { ConversionChildCrashedError } from './workerTermination';

class FakeChild extends EventEmitter {
  pid: number;

  connected = true;

  readonly sent: ParentToChildMessage[] = [];

  killed: NodeJS.Signals | number | null = null;

  constructor(pid: number) {
    super();
    this.pid = pid;
  }

  send(message: ParentToChildMessage): boolean {
    this.sent.push(message);
    return true;
  }

  kill(signal?: NodeJS.Signals | number): boolean {
    this.killed = signal ?? 'SIGTERM';
    this.connected = false;
    this.emit('exit', null, typeof signal === 'string' ? signal : 'SIGKILL');
    return true;
  }

  disconnect(): void {
    this.connected = false;
  }

  ready(): void {
    this.emit('message', { kind: 'ready' });
  }

  result(taskId: number, value: unknown, rssBytes = 0): void {
    this.emit('message', { kind: 'result', taskId, rssBytes, value });
  }

  failTask(taskId: number, error: SerializedTaskError, rssBytes = 0): void {
    this.emit('message', { kind: 'error', taskId, rssBytes, error });
  }

  progress(taskId: number, step: string): void {
    this.emit('message', { kind: 'progress', taskId, step });
  }

  heartbeat(memory: ChildMemorySample): void {
    this.emit('message', { kind: 'heartbeat', memory });
  }

  crash(code: number | null, signal: NodeJS.Signals | null = null): void {
    this.connected = false;
    this.emit('exit', code, signal);
  }

  sentKinds(): string[] {
    return this.sent.map((m) => m.kind);
  }
}

interface FakeTimer {
  id: number;
  cb: () => void;
}

function makeTimers() {
  const timeouts: FakeTimer[] = [];
  const intervals: FakeTimer[] = [];
  let nextId = 1;
  const api = {
    setTimeoutFn: (cb: () => void) => {
      const handle = { id: nextId++, cb };
      timeouts.push(handle);
      return handle;
    },
    clearTimeoutFn: (handle: unknown) => {
      const i = timeouts.indexOf(handle as FakeTimer);
      if (i >= 0) timeouts.splice(i, 1);
    },
    setIntervalFn: (cb: () => void) => {
      const handle = { id: nextId++, cb };
      intervals.push(handle);
      return handle;
    },
    clearIntervalFn: (handle: unknown) => {
      const i = intervals.indexOf(handle as FakeTimer);
      if (i >= 0) intervals.splice(i, 1);
    },
  };
  return {
    api,
    fireTimeouts: () => {
      const due = timeouts.splice(0);
      due.forEach((t) => t.cb());
    },
    tickIntervals: () => {
      [...intervals].forEach((t) => t.cb());
    },
  };
}

const taskLines = (logs: string[]) =>
  logs.filter((line) => line.startsWith('[conversion-pool] task '));

function makePool(overrides: Partial<ProcessPoolDeps> = {}) {
  const created: FakeChild[] = [];
  let nextPid = 1000;
  const forkFn: ForkFn = () => {
    const child = new FakeChild(++nextPid);
    created.push(child);
    return child as unknown as PooledChild;
  };
  const timers = makeTimers();
  const logs: string[] = [];
  const warns: string[] = [];
  const killGroupFn = vi.fn();
  const pool = new ConversionProcessPool({
    forkFn,
    childModulePath: '/app/src/lib/conversionChild.js',
    childExecArgv: [],
    childEnv: {},
    maxChildren: 2,
    recycleTasks: 50,
    retireRssBytes: 1_000_000_000,
    guardRssBytes: 2_000_000_000,
    killGraceMs: 10_000,
    rssPollMs: 5_000,
    readChildRss: () => null,
    killGroupFn,
    log: (line) => logs.push(line),
    warn: (line) => warns.push(line),
    ...timers.api,
    ...overrides,
  });
  return { pool, created, timers, logs, warns, killGroupFn };
}

describe('resolveConversionChildEntry', () => {
  it('forks the compiled child without tsx when running from .js', () => {
    expect(
      resolveConversionChildEntry('/srv/app/src/lib/conversionPool.js')
    ).toEqual({
      filename: '/srv/app/src/lib/conversionChild.js',
      execArgv: ['--max-old-space-size=1024'],
    });
  });

  it('forks the TypeScript child through tsx when running from source', () => {
    expect(
      resolveConversionChildEntry('/repo/src/lib/conversionPool.ts')
    ).toEqual({
      filename: '/repo/src/lib/conversionChild.ts',
      execArgv: ['--require', 'tsx/cjs', '--max-old-space-size=1024'],
    });
  });
});

describe('buildChildEnv', () => {
  it('strips NODE_OPTIONS and sets child + DB pool env', () => {
    const env = buildChildEnv({
      NODE_OPTIONS: '--max-old-space-size=16384',
      DATABASE_URL: 'postgres://x',
    });
    expect(env.NODE_OPTIONS).toBeUndefined();
    expect(env.CONVERSION_CHILD).toBe('1');
    expect(env.PGAPPNAME).toBe('2anki-conversion-child');
    expect(env.DATABASE_POOL_MIN).toBe('0');
    expect(env.DATABASE_POOL_MAX).toBe('3');
    expect(env.DATABASE_URL).toBe('postgres://x');
  });
});

describe('ConversionProcessPool scheduling', () => {
  it('spawns one warm child on start', () => {
    const { pool, created } = makePool();
    pool.start();
    expect(created).toHaveLength(1);
  });

  it('dispatches queued tasks FIFO and never exceeds the child cap', async () => {
    const { pool, created } = makePool({ maxChildren: 2 });
    pool.start();
    const first = pool.runTask('task-1');
    const second = pool.runTask('task-2');
    const third = pool.runTask('task-3');

    expect(created).toHaveLength(2);
    const taskIdsFor = (child: FakeChild) =>
      child.sent
        .filter((m) => m.kind === 'task')
        .map((m) => (m as { taskId: number }).taskId);

    created[0].ready();
    created[1].ready();
    // FIFO: the first two tasks go to the two children in spawn order.
    expect(taskIdsFor(created[0])).toEqual([1]);
    expect(taskIdsFor(created[1])).toEqual([2]);

    created[0].result(1, 'r1', 10);
    await first;
    // The next queued task (3) goes to the first child to free up — never a
    // third child, because the cap is 2.
    expect(created).toHaveLength(2);
    expect(taskIdsFor(created[0])).toEqual([1, 3]);

    created[1].result(2, 'r2', 10);
    created[0].result(3, 'r3', 10);
    expect(await second).toBe('r2');
    expect(await third).toBe('r3');
    expect(await first).toBe('r1');
  });

  it('retires a child after the recycle task budget', async () => {
    const { pool, created } = makePool({ recycleTasks: 2 });
    pool.start();
    const a = pool.runTask('a');
    created[0].ready();
    created[0].result(1, 'ra', 10);
    await a;
    const b = pool.runTask('b');
    created[0].result(2, 'rb', 10);
    await b;
    expect(created[0].sentKinds()).toContain('retire');
  });

  it('retires a child when its post-task RSS crosses the threshold', async () => {
    const { pool, created, logs } = makePool({ retireRssBytes: 1_000 });
    pool.start();
    const a = pool.runTask('a');
    created[0].ready();
    created[0].result(1, 'ra', 5_000);
    await a;
    expect(created[0].sentKinds()).toContain('retire');
    expect(
      logs.some((l) => l.includes('retired') && l.includes('reason=rss'))
    ).toBe(true);
  });

  it('rejects a crashed in-flight task and spawns a replacement', async () => {
    const { pool, created } = makePool();
    pool.start();
    const run = pool.runTask('a');
    created[0].ready();
    created[0].crash(137, 'SIGKILL');
    await expect(run).rejects.toBeInstanceOf(ConversionChildCrashedError);
    expect(created).toHaveLength(2);
  });

  it('logs the RSS guard crossing but does not kill (log-only first)', () => {
    const { pool, created, warns, killGroupFn, timers } = makePool({
      guardRssBytes: 1_000,
      readChildRss: () => 5_000,
    });
    pool.start();
    timers.tickIntervals();
    expect(warns.some((l) => l.includes('rss-guard'))).toBe(true);
    expect(killGroupFn).not.toHaveBeenCalled();
    expect(created[0].killed).toBeNull();
  });

  it('routes progress to the task that owns the taskId', () => {
    const { pool, created } = makePool();
    pool.start();
    const onProgress = vi.fn();
    pool.runTask('a', onProgress);
    created[0].ready();
    created[0].progress(1, 'step-x');
    created[0].progress(2, 'wrong-task');
    expect(onProgress).toHaveBeenCalledTimes(1);
    expect(onProgress).toHaveBeenCalledWith('step-x');
  });

  it('resolves a drain once in-flight work finishes', async () => {
    const { pool, created } = makePool();
    pool.start();
    const run = pool.runTask('a');
    created[0].ready();
    created[0].result(1, 'ra', 10);
    await run;
    const done = pool.shutdown();
    await expect(done).resolves.toBeUndefined();
    expect(created[0].sentKinds()).toContain('retire');
  });

  it('on drain timeout rejects in-flight tasks and kills child groups', async () => {
    const { pool, created, timers, killGroupFn } = makePool();
    pool.start();
    const run = pool.runTask('a');
    created[0].ready();
    const done = pool.shutdown(1_000);
    timers.fireTimeouts();
    await expect(run).rejects.toThrow('Terminating worker thread');
    await expect(done).resolves.toBeUndefined();
    expect(killGroupFn).toHaveBeenCalledWith(created[0].pid, 'SIGKILL');
  });

  describe('background lane', () => {
    const taskIdsFor = (child: FakeChild) =>
      child.sent
        .filter((m) => m.kind === 'task')
        .map((m) => (m as { taskId: number }).taskId);

    const background = (owner: string) => ({
      kind: 'background' as const,
      owner,
    });

    it('keeps a child free for an upload queued behind long background tasks', () => {
      const { pool, created } = makePool({ maxChildren: 4 });
      pool.start();
      ['a', 'b', 'c', 'd'].forEach((owner) =>
        pool.runTask(`notion-${owner}`, undefined, background(owner))
      );
      pool.runTask('upload');
      created.forEach((child) => child.ready());

      const dispatched = created.flatMap(taskIdsFor);
      expect(dispatched).toHaveLength(4);
      expect(dispatched).toContain(5);
      expect(dispatched).not.toContain(4);
    });

    it('leaves the last child idle when only background tasks are queued', () => {
      const { pool, created } = makePool({ maxChildren: 4 });
      pool.start();
      ['a', 'b', 'c', 'd'].forEach((owner) =>
        pool.runTask(`notion-${owner}`, undefined, background(owner))
      );
      created.forEach((child) => child.ready());

      expect(created.flatMap(taskIdsFor).sort()).toEqual([1, 2, 3]);
      expect(pool.describe()).toMatchObject({
        queueSize: 1,
        busyBackground: 3,
        queuedInteractive: 0,
      });
    });

    it('dispatches another owner before a second task from a busy owner', () => {
      const { pool, created } = makePool({ maxChildren: 4 });
      pool.start();
      for (let i = 0; i < 5; i += 1) {
        pool.runTask(`notion-a-${i}`, undefined, background('a'));
      }
      pool.runTask('notion-b', undefined, background('b'));
      created[0].ready();
      created[1].ready();

      expect(taskIdsFor(created[0])).toEqual([1]);
      expect(taskIdsFor(created[1])).toEqual([6]);
    });

    it('lets one owner use the spare background slots when no one else waits', () => {
      const { pool, created } = makePool({ maxChildren: 4 });
      pool.start();
      for (let i = 0; i < 5; i += 1) {
        pool.runTask(`notion-a-${i}`, undefined, background('a'));
      }
      created.forEach((child) => child.ready());

      expect(created.flatMap(taskIdsFor).sort()).toEqual([1, 2, 3]);
    });

    it('still runs background work on a single-child pool', () => {
      const { pool, created } = makePool({ maxChildren: 1 });
      pool.start();
      pool.runTask('notion-a', undefined, background('a'));
      created[0].ready();

      expect(taskIdsFor(created[0])).toEqual([1]);
    });

    it('drains queued background tasks on every child at shutdown', () => {
      const { pool, created } = makePool({ maxChildren: 2 });
      pool.start();
      for (let i = 0; i < 4; i += 1) {
        pool.runTask(`notion-a-${i}`, undefined, background('a'));
      }
      created.forEach((child) => child.ready());
      expect(created.flatMap(taskIdsFor)).toEqual([1]);

      void pool.shutdown();

      expect(created.flatMap(taskIdsFor).sort()).toEqual([1, 2]);
    });

    it('hands a freed background slot to the next upload first', async () => {
      const { pool, created } = makePool({ maxChildren: 2 });
      pool.start();
      const first = pool.runTask('notion-a', undefined, background('a'));
      pool.runTask('notion-b', undefined, background('b'));
      pool.runTask('upload-1');
      created.forEach((child) => child.ready());
      expect(created.flatMap(taskIdsFor).sort()).toEqual([1, 3]);

      created[0].result(1, 'done', 10);
      await first;
      expect(taskIdsFor(created[0])).toEqual([1, 2]);
    });
  });

  it('describe reports how long the oldest queued upload has waited', () => {
    let clock = 1_000;
    const { pool, created } = makePool({ maxChildren: 1, now: () => clock });
    pool.start();
    pool.runTask('upload-1');
    clock = 2_000;
    pool.runTask('notion-a', undefined, { kind: 'background', owner: 'a' });
    pool.runTask('upload-2');
    created[0].ready();
    clock = 61_000;

    expect(pool.describe().oldestInteractiveWaitMs).toBe(59_000);
  });

  it('describe reports how long each running task has held its child, by lane', () => {
    let clock = 1_000;
    const { pool, created } = makePool({ maxChildren: 3, now: () => clock });
    pool.start();
    pool.runTask('upload-1');
    pool.runTask('notion-a', undefined, { kind: 'background', owner: 'a' });
    created.forEach((child) => child.ready());
    clock = 11_000;
    pool.runTask('upload-2');
    created.forEach((child) => child.ready());
    clock = 31_000;

    const snapshot = pool.describe();
    expect([...snapshot.uploadRunsMs].sort((a, b) => a - b)).toEqual([
      20_000, 30_000,
    ]);
    expect(snapshot.backgroundRunsMs).toEqual([30_000]);
  });

  it('describe counts a run from dispatch, not from when the task queued', () => {
    let clock = 1_000;
    const { pool, created } = makePool({ maxChildren: 1, now: () => clock });
    pool.start();
    pool.runTask('upload-1');
    pool.runTask('upload-2');
    created[0].ready();
    clock = 50_000;
    created[0].result(1, 'done');
    clock = 58_000;

    expect(pool.describe().uploadRunsMs).toEqual([8_000]);
  });

  it('describe stops counting a task once it has finished', async () => {
    let clock = 1_000;
    const { pool, created } = makePool({ maxChildren: 1, now: () => clock });
    pool.start();
    const task = pool.runTask('upload-1');
    created[0].ready();
    clock = 90_000;
    created[0].result(1, 'done');
    await task;
    clock = 500_000;

    expect(pool.describe()).toMatchObject({
      uploadRunsMs: [],
      backgroundRunsMs: [],
    });
  });

  it('describe stops counting a task whose child crashed', async () => {
    let clock = 1_000;
    const { pool, created } = makePool({ maxChildren: 1, now: () => clock });
    pool.start();
    const task = pool.runTask('upload-1');
    created[0].ready();
    clock = 90_000;
    created[0].crash(1);
    await expect(task).rejects.toBeInstanceOf(ConversionChildCrashedError);

    expect(pool.describe().uploadRunsMs).toEqual([]);
  });

  it('logs how long a finished upload task waited and ran', async () => {
    let clock = 1_000;
    const { pool, created, logs } = makePool({
      maxChildren: 1,
      now: () => clock,
    });
    pool.start();
    const task = pool.runTask('upload-1');
    clock = 3_000;
    created[0].ready();
    clock = 45_000;
    created[0].result(1, 'done');
    await task;

    expect(taskLines(logs)).toEqual([
      '[conversion-pool] task lane=upload outcome=ok run_ms=42000 wait_ms=2000',
    ]);
  });

  it('logs a failed background task with its lane and outcome', async () => {
    let clock = 1_000;
    const { pool, created, logs } = makePool({
      maxChildren: 2,
      now: () => clock,
    });
    pool.start();
    const task = pool.runTask('notion-a', undefined, {
      kind: 'background',
      owner: 'a',
    });
    created[0].ready();
    clock = 6_000;
    created[0].failTask(1, { name: 'Error', message: 'boom' });
    await expect(task).rejects.toThrow('boom');

    expect(taskLines(logs)).toEqual([
      '[conversion-pool] task lane=background outcome=error run_ms=5000 wait_ms=0',
    ]);
  });

  it('logs a task whose child crashed with how long it had run', async () => {
    let clock = 1_000;
    const { pool, created, logs } = makePool({
      maxChildren: 1,
      now: () => clock,
    });
    pool.start();
    const task = pool.runTask('upload-1');
    created[0].ready();
    clock = 90_000;
    created[0].crash(1);
    await expect(task).rejects.toBeInstanceOf(ConversionChildCrashedError);

    expect(taskLines(logs)).toEqual([
      '[conversion-pool] task lane=upload outcome=crashed run_ms=89000 wait_ms=0',
    ]);
  });

  it('logs a crashed task once even when its result arrives afterwards', async () => {
    const { pool, created, logs } = makePool({ maxChildren: 1 });
    pool.start();
    const task = pool.runTask('upload-1');
    created[0].ready();
    created[0].crash(1);
    await expect(task).rejects.toBeInstanceOf(ConversionChildCrashedError);
    created[0].result(1, 'late');

    expect(taskLines(logs)).toEqual([
      '[conversion-pool] task lane=upload outcome=crashed run_ms=0 wait_ms=0',
    ]);
  });

  it('logs a task the drain deadline cut off, with how long it had run', async () => {
    let clock = 1_000;
    const { pool, created, timers, logs } = makePool({
      maxChildren: 1,
      now: () => clock,
    });
    pool.start();
    const task = pool.runTask('upload-1');
    created[0].ready();
    clock = 301_000;
    const done = pool.shutdown(1_000);
    timers.fireTimeouts();
    await expect(task).rejects.toThrow('Terminating worker thread');
    await done;

    expect(taskLines(logs)).toEqual([
      '[conversion-pool] task lane=upload outcome=terminated run_ms=300000 wait_ms=0',
    ]);
  });

  it('logs nothing for a task still queued when the drain deadline passes', async () => {
    const { pool, created, timers, logs } = makePool({ maxChildren: 1 });
    pool.start();
    const running = pool.runTask('upload-1');
    const queued = pool.runTask('upload-2');
    created[0].ready();
    const done = pool.shutdown(1_000);
    timers.fireTimeouts();
    await expect(running).rejects.toThrow('Terminating worker thread');
    await expect(queued).rejects.toThrow('Terminating worker thread');
    await done;

    expect(taskLines(logs)).toHaveLength(1);
  });

  it('describe reports no wait when no upload is queued', () => {
    const { pool } = makePool({ now: () => 5_000 });
    pool.start();
    pool.runTask('notion-a', undefined, { kind: 'background', owner: 'a' });

    expect(pool.describe().oldestInteractiveWaitMs).toBe(0);
  });

  it('describe reports queue, children and summed RSS', () => {
    const { pool, created } = makePool();
    pool.start();
    pool.runTask('a');
    created[0].ready();
    created[0].heartbeat({
      rss: 200 * 1024 * 1024,
      heapTotal: 0,
      heapUsed: 0,
      external: 0,
      arrayBuffers: 0,
    });
    const snapshot = pool.describe();
    expect(snapshot).toMatchObject({
      queueSize: 0,
      threads: 1,
      children: 1,
      childrenRssMb: 200,
    });
    expect(snapshot.utilization).toBe(1);
  });
});
