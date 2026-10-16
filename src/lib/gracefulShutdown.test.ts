import { vi, type Mock, type MockInstance } from 'vitest';
vi.mock('./conversionPool', async () => {
  const actual =
    await vi.importActual<typeof import('./conversionPool')>(
      './conversionPool'
    );
  return {
    __esModule: true,
    shutdownConversionPool: vi.fn(),
    describeConversionPool: vi.fn(() => ({
      queueSize: 2,
      threads: 3,
      utilization: 0.5,
    })),
    POOL_CLOSE_TIMEOUT_MS: actual.POOL_CLOSE_TIMEOUT_MS,
  };
});

import type http from 'http';
import type { Knex } from 'knex';
import { shutdownConversionPool } from './conversionPool';
import {
  describeActiveResources,
  describeDatabasePool,
  gracefulShutdown,
  HTTP_CLOSE_DEADLINE_MS,
  HTTP_CLOSE_GRACE_MS,
  POOL_DRAIN_TIMEOUT_MS,
  SHUTDOWN_TIMEOUT_MS,
  PM2_KILL_TIMEOUT_MS,
  resetGracefulShutdownStateForTesting,
} from './gracefulShutdown';

function fakeServer(): {
  server: http.Server;
  calls: { close: number; idle: number };
} {
  const calls = { close: 0, idle: 0 };
  const server = {
    close: (cb?: () => void) => {
      calls.close += 1;
      if (cb) cb();
      return server;
    },
    closeIdleConnections: () => {
      calls.idle += 1;
    },
  } as unknown as http.Server;
  return { server, calls };
}

function fakeDatabase(overrides: { destroy?: () => Promise<void> } = {}): {
  db: Knex;
  destroyCalls: { count: number };
} {
  const destroyCalls = { count: 0 };
  const db = {
    destroy:
      overrides.destroy ??
      (() => {
        destroyCalls.count += 1;
        return Promise.resolve();
      }),
  } as unknown as Knex;
  return { db, destroyCalls };
}

describe('gracefulShutdown', () => {
  let exitSpy: MockInstance;
  let infoSpy: MockInstance;
  let errorSpy: MockInstance;
  const drainMock = shutdownConversionPool as Mock;

  beforeEach(() => {
    drainMock.mockReset();
    drainMock.mockResolvedValue(undefined);
    resetGracefulShutdownStateForTesting();
    exitSpy = vi
      .spyOn(process, 'exit')
      .mockImplementation(() => undefined as never);
    infoSpy = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    exitSpy.mockRestore();
    infoSpy.mockRestore();
    errorSpy.mockRestore();
  });

  it('drains HTTP, conversion pool, and DB pool, then exits 0', async () => {
    const { server, calls } = fakeServer();
    const { db, destroyCalls } = fakeDatabase();

    await gracefulShutdown('SIGTERM', server, db);

    expect(calls.idle).toBe(1);
    expect(calls.close).toBe(1);
    expect(drainMock).toHaveBeenCalledWith({
      timeoutMs: POOL_DRAIN_TIMEOUT_MS,
    });
    expect(destroyCalls.count).toBe(1);
    expect(exitSpy).toHaveBeenCalledWith(0);
  });

  it('still exits 0 if the conversion pool drain throws', async () => {
    drainMock.mockRejectedValue(new Error('drain failed'));
    const { server } = fakeServer();
    const { db } = fakeDatabase();

    await gracefulShutdown('SIGINT', server, db);

    expect(exitSpy).toHaveBeenCalledWith(0);
    expect(errorSpy).toHaveBeenCalledWith(
      'Conversion pool drain failed:',
      expect.any(Error)
    );
  });

  it('still exits 0 if database.destroy throws', async () => {
    const { server } = fakeServer();
    const { db } = fakeDatabase({
      destroy: () => Promise.reject(new Error('pool teardown failed')),
    });

    await gracefulShutdown('SIGINT', server, db);

    expect(exitSpy).toHaveBeenCalledWith(0);
    expect(errorSpy).toHaveBeenCalledWith(
      'Database pool teardown failed:',
      expect.any(Error)
    );
  });

  it('is idempotent — a second signal during drain is a no-op', async () => {
    let release: (() => void) | null = null;
    drainMock.mockReturnValue(
      new Promise<void>((resolve) => {
        release = resolve;
      })
    );
    const { server } = fakeServer();
    const { db } = fakeDatabase();

    const first = gracefulShutdown('SIGTERM', server, db);
    const second = gracefulShutdown('SIGINT', server, db);

    release!();
    await Promise.all([first, second]);

    expect(exitSpy).toHaveBeenCalledTimes(1);
    expect(drainMock).toHaveBeenCalledTimes(1);
  });

  it('orders the timeouts so drain finishes before the hard exit and pm2 SIGKILL', () => {
    expect(POOL_DRAIN_TIMEOUT_MS).toBeLessThan(SHUTDOWN_TIMEOUT_MS);
    expect(SHUTDOWN_TIMEOUT_MS).toBeLessThan(PM2_KILL_TIMEOUT_MS);
  });

  it('keeps the sever deadline inside the hard-exit reserve after a full pool drain', () => {
    expect(HTTP_CLOSE_DEADLINE_MS).toBeGreaterThanOrEqual(
      POOL_DRAIN_TIMEOUT_MS
    );
    expect(HTTP_CLOSE_DEADLINE_MS).toBeLessThan(SHUTDOWN_TIMEOUT_MS);
  });

  function holdingServer(): {
    server: http.Server;
    calls: { closeAll: number };
    finishClose: () => void;
  } {
    let closeCb: (() => void) | undefined;
    const calls = { closeAll: 0 };
    // An in-flight request (an upload mid-conversion, an SSE stream): the
    // server only closes once the handler ends it or the socket is destroyed.
    const server = {
      close: (cb?: () => void) => {
        closeCb = cb;
        return server;
      },
      closeIdleConnections: () => undefined,
      closeAllConnections: () => {
        calls.closeAll += 1;
        closeCb?.();
      },
    } as unknown as http.Server;
    return { server, calls, finishClose: () => closeCb?.() };
  }

  it('keeps an upload connection open until its conversion drains from the pool', async () => {
    vi.useFakeTimers();
    const warnSpy = vi
      .spyOn(console, 'warn')
      .mockImplementation(() => undefined);
    let releasePool: (() => void) | undefined;
    drainMock.mockReturnValue(
      new Promise<void>((resolve) => {
        releasePool = resolve;
      })
    );
    const { server, calls, finishClose } = holdingServer();
    const { db, destroyCalls } = fakeDatabase();

    const done = gracefulShutdown('SIGINT', server, db);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(calls.closeAll).toBe(0);
    expect(destroyCalls.count).toBe(0);

    releasePool!();
    await vi.advanceTimersByTimeAsync(HTTP_CLOSE_GRACE_MS - 1);
    expect(calls.closeAll).toBe(0);
    finishClose();
    await vi.advanceTimersByTimeAsync(HTTP_CLOSE_GRACE_MS);
    await done;

    expect(calls.closeAll).toBe(0);
    expect(warnSpy).not.toHaveBeenCalled();
    expect(destroyCalls.count).toBe(1);
    expect(exitSpy).toHaveBeenCalledWith(0);
    warnSpy.mockRestore();
    vi.useRealTimers();
  });

  it('severs connections still open after the pool drained plus the grace so the exit still runs', async () => {
    vi.useFakeTimers();
    const warnSpy = vi
      .spyOn(console, 'warn')
      .mockImplementation(() => undefined);
    const { server, calls } = holdingServer();
    const { db, destroyCalls } = fakeDatabase();

    const done = gracefulShutdown('SIGINT', server, db);
    await vi.advanceTimersByTimeAsync(HTTP_CLOSE_GRACE_MS - 1);
    expect(calls.closeAll).toBe(0);
    await vi.advanceTimersByTimeAsync(2);
    await done;

    expect(calls.closeAll).toBe(1);
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('severing remaining connections')
    );
    expect(drainMock).toHaveBeenCalledTimes(1);
    expect(destroyCalls.count).toBe(1);
    expect(exitSpy).toHaveBeenCalledWith(0);
    warnSpy.mockRestore();
    vi.useRealTimers();
  });

  it('severs at the deadline, not grace later, when the pool drain ran to its timeout', async () => {
    vi.useFakeTimers();
    const warnSpy = vi
      .spyOn(console, 'warn')
      .mockImplementation(() => undefined);
    let releasePool: (() => void) | undefined;
    drainMock.mockReturnValue(
      new Promise<void>((resolve) => {
        releasePool = resolve;
      })
    );
    const { server, calls } = holdingServer();
    const { db, destroyCalls } = fakeDatabase();

    const done = gracefulShutdown('SIGINT', server, db);
    await vi.advanceTimersByTimeAsync(POOL_DRAIN_TIMEOUT_MS);
    releasePool!();
    await vi.advanceTimersByTimeAsync(
      HTTP_CLOSE_DEADLINE_MS - POOL_DRAIN_TIMEOUT_MS + 1
    );
    await done;

    expect(calls.closeAll).toBe(1);
    expect(destroyCalls.count).toBe(1);
    expect(exitSpy).toHaveBeenCalledWith(0);
    expect(exitSpy).not.toHaveBeenCalledWith(1);
    warnSpy.mockRestore();
    vi.useRealTimers();
  });

  it('does not warn about a sever when HTTP closed before the pool drained', async () => {
    vi.useFakeTimers();
    const warnSpy = vi
      .spyOn(console, 'warn')
      .mockImplementation(() => undefined);
    let releasePool: (() => void) | undefined;
    drainMock.mockReturnValue(
      new Promise<void>((resolve) => {
        releasePool = resolve;
      })
    );
    const { server, calls } = fakeServer();
    const { db } = fakeDatabase();

    const done = gracefulShutdown('SIGINT', server, db);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(calls.close).toBe(1);
    releasePool!();
    await vi.advanceTimersByTimeAsync(HTTP_CLOSE_GRACE_MS + 1);
    await done;

    expect(warnSpy).not.toHaveBeenCalled();
    expect(exitSpy).toHaveBeenCalledWith(0);
    warnSpy.mockRestore();
    vi.useRealTimers();
  });

  it('names the stuck phase and the open resources when the hard exit fires', async () => {
    vi.useFakeTimers();
    const { server } = fakeServer();
    const { db } = fakeDatabase();
    (db as unknown as { client: unknown }).client = {
      pool: {
        numUsed: () => 4,
        numFree: () => 1,
        numPendingAcquires: () => 2,
        numPendingCreates: () => 0,
      },
    };
    drainMock.mockReturnValue(new Promise(() => undefined));

    const done = gracefulShutdown('SIGINT', server, db);
    await vi.advanceTimersByTimeAsync(SHUTDOWN_TIMEOUT_MS + 1);

    expect(exitSpy).toHaveBeenCalledWith(1);
    const [message, details] = errorSpy.mock.calls.find(([m]) =>
      String(m).includes('forcing exit')
    ) as [string, Record<string, unknown>];
    expect(message).toContain('during conversion pool drain');
    expect(details).toMatchObject({
      databasePool: { used: 4, free: 1, pendingAcquires: 2, pendingCreates: 0 },
      conversionPool: { queueSize: 2, threads: 3, utilization: 0.5 },
    });
    expect(details.activeResources).toEqual(expect.any(Object));
    vi.useRealTimers();
    void done;
  });

  it('logs how long each drain phase took so a slow deploy shows which one ate the clock', async () => {
    const { server } = fakeServer();
    const { db } = fakeDatabase();
    await gracefulShutdown('SIGINT', server, db);
    const phases = infoSpy.mock.calls
      .map(([m]) => String(m))
      .filter((m) => / drained in \d+ms$/.test(m));
    expect(phases.slice(0, 2).sort()).toEqual([
      expect.stringMatching(/^Conversion pool drained in \d+ms$/),
      expect.stringMatching(/^HTTP server drained in \d+ms$/),
    ]);
    expect(phases.slice(2)).toEqual([
      expect.stringMatching(/^Events sink drained in \d+ms$/),
      expect.stringMatching(/^Database pool drained in \d+ms$/),
    ]);
  });

  it('reports null for a database client without a tarn pool and defaults missing counters', () => {
    expect(describeDatabasePool({} as Knex)).toBeNull();
    expect(
      describeDatabasePool({
        client: { pool: { numUsed: () => 3 } },
      } as unknown as Knex)
    ).toEqual({ used: 3, free: 0, pendingAcquires: 0, pendingCreates: 0 });
  });

  it('tallies active resource handles by type', () => {
    const spy = vi
      .spyOn(process, 'getActiveResourcesInfo')
      .mockReturnValue(['Timeout', 'Timeout', 'TCPSocketWrap']);
    expect(describeActiveResources()).toEqual({ Timeout: 2, TCPSocketWrap: 1 });
    spy.mockRestore();
  });

  it('gives in-flight conversions room past the old 23s window that force-killed large decks', () => {
    expect(POOL_DRAIN_TIMEOUT_MS).toBeGreaterThanOrEqual(60_000);
  });
});
