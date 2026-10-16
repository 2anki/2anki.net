import type http from 'http';
import type { Knex } from 'knex';
import {
  describeConversionPool,
  shutdownConversionPool,
  POOL_CLOSE_TIMEOUT_MS,
} from './conversionPool';
import { clearSchedulerTimers } from './scheduling/timerRegistry';
import { getEventsSink } from '../services/events/eventsSinkInstance';

// pm2 sends SIGINT then escalates to SIGKILL after kill_timeout
// (ecosystem.blue-green.config.js). Blue-green puts the new color live before
// the old color drains, so a slow drain on the retiring process never delays a
// user — the budget only needs to outlast the slowest legitimate conversion.
export const PM2_KILL_TIMEOUT_MS = 90_000;
// Reserve under PM2_KILL_TIMEOUT_MS so process.exit fires before pm2's SIGKILL.
export const SHUTDOWN_TIMEOUT_MS = 85_000;
// The drain budget the conversion child pool gets: it keeps dispatching queued
// tasks and waits for in-flight ones, then on this timeout rejects the stragglers
// (callers mark the job interrupted) and SIGKILLs the child groups. A large
// Notion deck (pagination plus image/PDF downloads plus the Python .apkg build)
// can run past the old 23s window; the 80s budget lets it finish, and the 5s
// reserve below SHUTDOWN_TIMEOUT_MS covers the trailing database.destroy().
export const POOL_DRAIN_TIMEOUT_MS = POOL_CLOSE_TIMEOUT_MS + 3_000;
// A synchronous upload holds its connection open while its conversion runs in
// the pool, so the HTTP close and the pool drain run together: closing HTTP
// first (the 2s budget from #4186) severed every upload the pool was about to
// finish, one to three per deploy and 23 on 2026-10-09, logged as "- -"
// right after "HTTP server drained in 2002ms". Idle connections still close at
// once. Whatever is open once the pool has drained gets this long to flush its
// response and is then severed, so an SSE stream or a stalled transfer cannot
// hold the clock past the pool's own bound (#4177) and the hard exit keeps a
// reserve: POOL_DRAIN_TIMEOUT_MS + HTTP_CLOSE_GRACE_MS < SHUTDOWN_TIMEOUT_MS.
export const HTTP_CLOSE_GRACE_MS = 1_000;

let shuttingDown = false;

export function resetGracefulShutdownStateForTesting(): void {
  shuttingDown = false;
}

type DrainPhase =
  | 'HTTP server'
  | 'Events sink'
  | 'Conversion pool'
  | 'Database pool';

export function describeActiveResources(): Record<string, number> {
  const tally: Record<string, number> = {};
  for (const kind of process.getActiveResourcesInfo()) {
    tally[kind] = (tally[kind] ?? 0) + 1;
  }
  return tally;
}

export function describeDatabasePool(database: Knex): {
  used: number;
  free: number;
  pendingAcquires: number;
  pendingCreates: number;
} | null {
  const pool = (
    database as unknown as {
      client?: {
        pool?: {
          numUsed?: () => number;
          numFree?: () => number;
          numPendingAcquires?: () => number;
          numPendingCreates?: () => number;
        };
      };
    }
  ).client?.pool;
  if (pool?.numUsed == null) return null;
  return {
    used: pool.numUsed(),
    free: pool.numFree?.() ?? 0,
    pendingAcquires: pool.numPendingAcquires?.() ?? 0,
    pendingCreates: pool.numPendingCreates?.() ?? 0,
  };
}

async function timedPhase(phase: DrainPhase, run: () => Promise<void>) {
  const startedAt = Date.now();
  await run();
  console.info(`${phase} drained in ${Date.now() - startedAt}ms`);
}

export async function gracefulShutdown(
  signal: string,
  server: http.Server,
  database: Knex
): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  console.info(`${signal} received — draining HTTP, conversion pool, DB pool`);

  const clearedTimers = clearSchedulerTimers();
  if (clearedTimers > 0) {
    console.info(`Cleared ${clearedTimers} scheduler timer(s)`);
  }

  let phase: DrainPhase = 'HTTP server';
  const hardExit = setTimeout(() => {
    console.error(
      `Graceful shutdown exceeded ${SHUTDOWN_TIMEOUT_MS}ms during ${phase.toLowerCase()} drain — forcing exit`,
      {
        activeResources: describeActiveResources(),
        databasePool: describeDatabasePool(database),
        conversionPool: describeConversionPool(),
      }
    );
    process.exit(1);
  }, SHUTDOWN_TIMEOUT_MS);
  hardExit.unref();

  const poolDrained = timedPhase('Conversion pool', async () => {
    try {
      await shutdownConversionPool({ timeoutMs: POOL_DRAIN_TIMEOUT_MS });
    } catch (err) {
      console.error('Conversion pool drain failed:', err);
    }
  });

  await timedPhase('HTTP server', async () => {
    server.closeIdleConnections?.();
    let closed = false;
    const closedPromise = new Promise<void>((resolve) =>
      server.close(() => {
        closed = true;
        resolve();
      })
    );
    let sever: NodeJS.Timeout | undefined;
    void poolDrained.then(() => {
      if (closed) return;
      sever = setTimeout(() => {
        console.warn(
          `HTTP close exceeded ${HTTP_CLOSE_GRACE_MS}ms after the conversion pool drained — severing remaining connections`
        );
        server.closeAllConnections?.();
      }, HTTP_CLOSE_GRACE_MS);
      sever.unref();
    });
    await closedPromise;
    clearTimeout(sever);
  });

  phase = 'Conversion pool';
  await poolDrained;

  // After the pool so the worker threads have finished flushing their own usage
  // rows into the main-thread sink; before the DB pool closes so the drained
  // rows still have a connection to land on.
  phase = 'Events sink';
  await timedPhase('Events sink', async () => {
    try {
      await getEventsSink().drain();
    } catch (err) {
      console.error('Events sink drain failed:', err);
    }
  });

  phase = 'Database pool';
  await timedPhase('Database pool', async () => {
    try {
      await database.destroy();
    } catch (err) {
      console.error('Database pool teardown failed:', err);
    }
  });

  clearTimeout(hardExit);
  console.info(`${signal} drain complete — exiting cleanly`);
  process.exit(0);
}
