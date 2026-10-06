import fs from 'node:fs';
import path from 'node:path';
import {
  ChildMemorySample,
  ChildToParentMessage,
  ParentToChildMessage,
  rebuildTaskError,
} from './conversionChildProtocol';
import { CONVERSION_CHILD_MAX_OLD_SPACE_ARG } from './conversionMemoryLimits';
import {
  ConversionChildCrashedError,
  createWorkerTerminationError,
} from './workerTermination';

// The subset of ChildProcess the pool uses. A test fork can satisfy it with an
// EventEmitter plus these three methods — no real process required.
export interface PooledChild {
  readonly pid?: number;
  readonly connected: boolean;
  send(message: ParentToChildMessage): boolean;
  kill(signal?: NodeJS.Signals | number): boolean;
  disconnect(): void;
  on(event: 'message', listener: (message: unknown) => void): unknown;
  on(
    event: 'exit',
    listener: (code: number | null, signal: NodeJS.Signals | null) => void
  ): unknown;
  on(event: 'error', listener: (error: Error) => void): unknown;
}

export interface ChildForkOptions {
  execArgv: string[];
  env: NodeJS.ProcessEnv;
  detached: boolean;
  serialization: 'advanced';
  stdio: Array<'inherit' | 'ipc'>;
}

export type ForkFn = (
  modulePath: string,
  args: string[],
  options: ChildForkOptions
) => PooledChild;

interface TimerApi {
  setTimeoutFn: (cb: () => void, ms: number) => unknown;
  clearTimeoutFn: (handle: unknown) => void;
  setIntervalFn: (cb: () => void, ms: number) => unknown;
  clearIntervalFn: (handle: unknown) => void;
}

export interface ProcessPoolDeps extends Partial<TimerApi> {
  forkFn: ForkFn;
  childModulePath: string;
  childExecArgv: string[];
  childEnv: NodeJS.ProcessEnv;
  maxChildren: number;
  recycleTasks: number;
  retireRssBytes: number;
  guardRssBytes: number;
  killGraceMs?: number;
  rssPollMs?: number;
  readChildRss?: (pid: number) => number | null;
  killGroupFn?: (pid: number, signal: NodeJS.Signals) => void;
  log?: (line: string) => void;
  warn?: (line: string) => void;
}

interface QueuedTask {
  taskId: number;
  payload: unknown;
  onProgress?: (step: string) => void;
  resolve: (value: unknown) => void;
  reject: (error: unknown) => void;
  settled: boolean;
}

interface ChildRecord {
  child: PooledChild;
  pid?: number;
  status: 'starting' | 'idle' | 'busy' | 'retiring';
  current: QueuedTask | null;
  tasksCompleted: number;
  lastMemory: ChildMemorySample | null;
  lastProcRssBytes: number | null;
  killTimer: unknown;
}

const DEFAULT_KILL_GRACE_MS = 10_000;
const DEFAULT_RSS_POLL_MS = 5_000;
const MEMORY_LOG_INTERVAL_MS = 60_000;
const BYTES_PER_MB = 1024 * 1024;

export function readProcRss(pid: number): number | null {
  try {
    const status = fs.readFileSync(`/proc/${pid}/status`, 'utf8');
    const match = /^VmRSS:\s+(\d+)\s+kB/m.exec(status);
    return match ? Number(match[1]) * 1024 : null;
  } catch {
    return null;
  }
}

function defaultKillGroup(pid: number, signal: NodeJS.Signals): void {
  try {
    process.kill(-pid, signal);
  } catch {
    // The group is already gone, or the child never became a group leader.
  }
}

export class ConversionProcessPool {
  private readonly queue: QueuedTask[] = [];

  private readonly children: ChildRecord[] = [];

  private nextTaskId = 1;

  private draining = false;

  private drainResolve: (() => void) | null = null;

  private drainTimer: unknown = null;

  private maintenanceTimer: unknown = null;

  private ticksSinceMemoryLog = 0;

  private readonly timers: TimerApi;

  private readonly killGraceMs: number;

  private readonly rssPollMs: number;

  private readonly readChildRss: (pid: number) => number | null;

  private readonly killGroup: (pid: number, signal: NodeJS.Signals) => void;

  private readonly log: (line: string) => void;

  private readonly warn: (line: string) => void;

  constructor(private readonly deps: ProcessPoolDeps) {
    this.timers = {
      setTimeoutFn:
        deps.setTimeoutFn ??
        ((cb, ms) => {
          const t = setTimeout(cb, ms);
          (t as { unref?: () => void }).unref?.();
          return t;
        }),
      clearTimeoutFn:
        deps.clearTimeoutFn ?? ((h) => clearTimeout(h as NodeJS.Timeout)),
      setIntervalFn:
        deps.setIntervalFn ??
        ((cb, ms) => {
          const t = setInterval(cb, ms);
          (t as { unref?: () => void }).unref?.();
          return t;
        }),
      clearIntervalFn:
        deps.clearIntervalFn ?? ((h) => clearInterval(h as NodeJS.Timeout)),
    };
    this.killGraceMs = deps.killGraceMs ?? DEFAULT_KILL_GRACE_MS;
    this.rssPollMs = deps.rssPollMs ?? DEFAULT_RSS_POLL_MS;
    this.readChildRss = deps.readChildRss ?? readProcRss;
    this.killGroup = deps.killGroupFn ?? defaultKillGroup;
    this.log = deps.log ?? ((line) => console.info(line));
    this.warn = deps.warn ?? ((line) => console.warn(line));
  }

  start(): void {
    if (this.maintenanceTimer == null) {
      this.maintenanceTimer = this.timers.setIntervalFn(
        () => this.maintenanceTick(),
        this.rssPollMs
      );
    }
    this.maybeDispatch();
  }

  runTask(
    payload: unknown,
    onProgress?: (step: string) => void
  ): Promise<unknown> {
    return new Promise<unknown>((resolve, reject) => {
      this.queue.push({
        taskId: this.nextTaskId++,
        payload,
        onProgress,
        resolve,
        reject,
        settled: false,
      });
      this.maybeDispatch();
    });
  }

  describe(): {
    queueSize: number;
    threads: number;
    utilization: number;
    children: number;
    childrenRssMb: number;
  } {
    const live = this.children.length;
    const busy = this.children.filter((c) => c.status === 'busy').length;
    const childrenRssBytes = this.children.reduce(
      (sum, c) => sum + (c.lastMemory?.rss ?? c.lastProcRssBytes ?? 0),
      0
    );
    return {
      queueSize: this.queue.length,
      threads: live,
      utilization: live === 0 ? 0 : Number((busy / live).toFixed(2)),
      children: live,
      childrenRssMb: Math.round(childrenRssBytes / BYTES_PER_MB),
    };
  }

  async shutdown(timeoutMs?: number): Promise<void> {
    if (this.draining) return;
    this.draining = true;
    if (this.maintenanceTimer != null) {
      this.timers.clearIntervalFn(this.maintenanceTimer);
      this.maintenanceTimer = null;
    }
    const done = new Promise<void>((resolve) => {
      this.drainResolve = resolve;
    });
    if (timeoutMs != null) {
      this.drainTimer = this.timers.setTimeoutFn(
        () => this.onDrainTimeout(),
        timeoutMs
      );
    }
    this.pumpDrain();
    await done;
  }

  private maybeDispatch(): void {
    for (const record of this.children) {
      if (this.queue.length === 0) break;
      if (record.status === 'idle') {
        this.dispatchTo(record, this.queue.shift()!);
      }
    }
    // Spawn only enough new children to cover the still-queued tasks, counting
    // children that are already starting as pending capacity so a single task
    // does not spin up the whole pool. Retiring children still count toward the
    // cap, so a replacement waits for the retiring one to exit.
    const startingCount = this.children.filter(
      (c) => c.status === 'starting'
    ).length;
    let needed = this.queue.length - startingCount;
    while (needed > 0 && this.children.length < this.deps.maxChildren) {
      this.spawnChild();
      needed -= 1;
    }
    // Keep one child warm so the first request after an idle spell is fast.
    if (!this.draining && this.children.length === 0) {
      this.spawnChild();
    }
  }

  private dispatchTo(record: ChildRecord, task: QueuedTask): void {
    record.status = 'busy';
    record.current = task;
    record.child.send({
      kind: 'task',
      taskId: task.taskId,
      payload: task.payload,
    });
  }

  private spawnChild(): void {
    const child = this.deps.forkFn(this.deps.childModulePath, [], {
      execArgv: this.deps.childExecArgv,
      env: this.deps.childEnv,
      detached: true,
      serialization: 'advanced',
      stdio: ['inherit', 'inherit', 'inherit', 'ipc'],
    });
    const record: ChildRecord = {
      child,
      pid: child.pid,
      status: 'starting',
      current: null,
      tasksCompleted: 0,
      lastMemory: null,
      lastProcRssBytes: null,
      killTimer: null,
    };
    this.children.push(record);
    this.log(
      `[conversion-pool] spawned pid=${child.pid ?? 'pending'} children=${this.children.length}`
    );
    child.on('message', (message) =>
      this.onMessage(record, message as ChildToParentMessage)
    );
    child.on('exit', (code, signal) => this.onExit(record, code, signal));
    child.on('error', (error) => this.onError(record, error));
  }

  private onMessage(record: ChildRecord, message: ChildToParentMessage): void {
    if (message == null) return;
    record.pid = record.pid ?? record.child.pid;
    switch (message.kind) {
      case 'ready':
        if (record.status === 'starting') {
          record.status = 'idle';
          if (this.draining && this.queue.length === 0) {
            this.retire(record);
            this.checkDrainDone();
          } else {
            this.maybeDispatch();
          }
        }
        return;
      case 'heartbeat':
        record.lastMemory = message.memory;
        return;
      case 'progress':
        if (record.current?.taskId === message.taskId) {
          record.current.onProgress?.(message.step);
        }
        return;
      case 'result':
        this.completeTask(record, message.taskId, message.rssBytes, () =>
          this.settle(record.current, 'resolve', message.value)
        );
        return;
      case 'error':
        this.completeTask(record, message.taskId, message.rssBytes, () =>
          this.settle(record.current, 'reject', rebuildTaskError(message.error))
        );
        return;
      default:
        return;
    }
  }

  private completeTask(
    record: ChildRecord,
    taskId: number,
    rssBytes: number,
    settle: () => void
  ): void {
    if (record.current?.taskId !== taskId) return;
    settle();
    record.current = null;
    record.status = 'idle';
    record.tasksCompleted += 1;
    this.afterTask(record, rssBytes);
  }

  private afterTask(record: ChildRecord, rssBytes: number): void {
    if (this.draining) {
      if (this.queue.length > 0) {
        this.dispatchTo(record, this.queue.shift()!);
      } else {
        this.retire(record);
        this.checkDrainDone();
      }
      return;
    }
    const overTaskBudget = record.tasksCompleted >= this.deps.recycleTasks;
    const overRss = rssBytes >= this.deps.retireRssBytes;
    if (overTaskBudget || overRss) {
      this.log(
        `[conversion-pool] retired pid=${record.pid ?? 'unknown'} reason=${overRss ? 'rss' : 'tasks'} tasks=${record.tasksCompleted} rss_mb=${Math.round(rssBytes / BYTES_PER_MB)}`
      );
      this.retire(record);
    }
    this.maybeDispatch();
  }

  private retire(record: ChildRecord): void {
    if (record.status === 'retiring') return;
    record.status = 'retiring';
    record.current = null;
    try {
      if (record.child.connected) {
        record.child.send({ kind: 'retire' });
      }
    } catch {
      // Channel already closed; the exit handler cleans up.
    }
    record.killTimer = this.timers.setTimeoutFn(() => {
      this.forceKill(record);
    }, this.killGraceMs);
  }

  private forceKill(record: ChildRecord): void {
    if (record.pid != null) {
      this.killGroup(record.pid, 'SIGKILL');
    }
    try {
      record.child.kill('SIGKILL');
    } catch {
      // Already dead.
    }
  }

  private onError(record: ChildRecord, error: Error): void {
    this.warn(
      `[conversion-pool] child error pid=${record.pid ?? 'unknown'}: ${error.message}`
    );
    this.onExit(record, null, null);
  }

  private onExit(
    record: ChildRecord,
    code: number | null,
    signal: NodeJS.Signals | null
  ): void {
    const index = this.children.indexOf(record);
    if (index === -1) return;
    this.children.splice(index, 1);
    if (record.killTimer != null) {
      this.timers.clearTimeoutFn(record.killTimer);
      record.killTimer = null;
    }
    const crashedTask = record.current;
    if (crashedTask != null && !crashedTask.settled) {
      this.log(
        `[conversion-pool] crashed pid=${record.pid ?? 'unknown'} exit=${code ?? 'null'} signal=${signal ?? 'null'}`
      );
      this.settle(
        crashedTask,
        'reject',
        new ConversionChildCrashedError({
          exitCode: code,
          signal,
          lastRssBytes: record.lastMemory?.rss ?? record.lastProcRssBytes,
          reason: 'conversion_process_crashed',
        })
      );
    }
    if (this.draining) {
      this.checkDrainDone();
    }
    this.maybeDispatch();
  }

  private settle(
    task: QueuedTask | null,
    outcome: 'resolve' | 'reject',
    valueOrError: unknown
  ): void {
    if (task == null || task.settled) return;
    task.settled = true;
    if (outcome === 'resolve') {
      task.resolve(valueOrError);
    } else {
      task.reject(valueOrError);
    }
  }

  private maintenanceTick(): void {
    for (const record of this.children) {
      if (record.pid == null) continue;
      const rss = this.readChildRss(record.pid);
      if (rss == null) continue;
      record.lastProcRssBytes = rss;
      if (rss >= this.deps.guardRssBytes) {
        // Log-only first: a follow-up flips this to a process-group kill once
        // the log confirms the ceiling is right (see conversionMemoryLimits.ts).
        this.warn(
          `[conversion-pool] rss-guard pid=${record.pid} rss_mb=${Math.round(rss / BYTES_PER_MB)} ceiling_mb=${Math.round(this.deps.guardRssBytes / BYTES_PER_MB)}`
        );
      }
    }
    this.ticksSinceMemoryLog += 1;
    const logEvery = Math.max(
      1,
      Math.round(MEMORY_LOG_INTERVAL_MS / this.rssPollMs)
    );
    if (this.ticksSinceMemoryLog >= logEvery) {
      this.ticksSinceMemoryLog = 0;
      this.logChildMemory();
    }
  }

  private logChildMemory(): void {
    for (const record of this.children) {
      const memory = record.lastMemory;
      if (memory == null) continue;
      this.log(
        `[memory.child] pid=${record.pid ?? 'unknown'} rss_mb=${Math.round(memory.rss / BYTES_PER_MB)} heap_used_mb=${Math.round(memory.heapUsed / BYTES_PER_MB)} external_mb=${Math.round(memory.external / BYTES_PER_MB)} tasks=${record.tasksCompleted} status=${record.status}`
      );
    }
  }

  private pumpDrain(): void {
    this.maybeDispatch();
    for (const record of [...this.children]) {
      if (record.status === 'idle') {
        this.retire(record);
      }
    }
    this.checkDrainDone();
  }

  private checkDrainDone(): void {
    if (!this.draining || this.drainResolve == null) return;
    const hasWork =
      this.queue.length > 0 ||
      this.children.some((c) => c.status === 'busy' || c.status === 'starting');
    if (hasWork) return;
    this.finishDrain();
  }

  private onDrainTimeout(): void {
    const termination = createWorkerTerminationError();
    for (const task of this.queue.splice(0)) {
      this.settle(task, 'reject', termination);
    }
    for (const record of this.children) {
      this.settle(record.current, 'reject', termination);
      record.current = null;
      this.forceKill(record);
    }
    this.log(
      '[conversion-pool] drain timeout — rejected in-flight conversions and killed child groups'
    );
    this.finishDrain();
  }

  private finishDrain(): void {
    if (this.drainTimer != null) {
      this.timers.clearTimeoutFn(this.drainTimer);
      this.drainTimer = null;
    }
    const resolve = this.drainResolve;
    this.drainResolve = null;
    for (const record of this.children) {
      if (record.status !== 'retiring') {
        this.retire(record);
      }
    }
    resolve?.();
  }
}

// Mirrors resolveConversionWorkerEntry: production forks the compiled .js with
// no tsx; a .ts caller (tests) forks conversionChild.ts through tsx. The V8
// old-gen cap is always applied via execArgv so it does not depend on the
// inherited (and deliberately stripped) NODE_OPTIONS.
export function resolveConversionChildEntry(callerFilename: string): {
  filename: string;
  execArgv: string[];
} {
  const dir = path.dirname(callerFilename);
  if (callerFilename.endsWith('.ts')) {
    return {
      filename: path.join(dir, 'conversionChild.ts'),
      execArgv: ['--require', 'tsx/cjs', CONVERSION_CHILD_MAX_OLD_SPACE_ARG],
    };
  }
  return {
    filename: path.join(dir, 'conversionChild.js'),
    execArgv: [CONVERSION_CHILD_MAX_OLD_SPACE_ARG],
  };
}

export function buildChildEnv(baseEnv: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...baseEnv };
  // The 16G main-process heap ceiling travels in NODE_OPTIONS; a child must not
  // inherit it (it gets its own 1G cap via execArgv instead).
  delete env.NODE_OPTIONS;
  env.CONVERSION_CHILD = '1';
  // Distinguishes child connections in pg_stat_activity.application_name so the
  // connection budget is readable per role.
  env.PGAPPNAME = '2anki-conversion-child';
  // A child owns a tiny pool; min 0 so an idle child holds nothing, max 3 so a
  // conversion's handful of concurrent repositories never starve.
  env.DATABASE_POOL_MIN = '0';
  env.DATABASE_POOL_MAX = '3';
  return env;
}
