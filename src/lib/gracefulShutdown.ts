import type http from 'http';
import type { Knex } from 'knex';
import {
  describeConversionPool,
  shutdownConversionPool,
  POOL_CLOSE_TIMEOUT_MS,
} from './conversionPool';
import { clearSchedulerTimers } from './scheduling/timerRegistry';

// pm2 sends SIGINT then escalates to SIGKILL after kill_timeout
// (ecosystem.blue-green.config.js). Blue-green puts the new color live before
// the old color drains, so a slow drain on the retiring process never delays a
// user — the budget only needs to outlast the slowest legitimate conversion.
export const PM2_KILL_TIMEOUT_MS = 90_000;
// Reserve under PM2_KILL_TIMEOUT_MS so process.exit fires before pm2's SIGKILL.
export const SHUTDOWN_TIMEOUT_MS = 85_000;
// Sits just above piscina's own closeTimeout: close() races the pool flush
// against that internal ceiling and self-destructs on timeout, so the outer
// race here gives piscina its full window first, then force-destroys only if
// close() itself hangs. A large Notion deck (pagination plus image/PDF
// downloads plus the Python .apkg build) can run past the old 23s window; the
// 80s pool budget lets it finish, and the 5s reserve below SHUTDOWN_TIMEOUT_MS
// covers the trailing database.destroy() before the hard exit.
export const POOL_DRAIN_TIMEOUT_MS = POOL_CLOSE_TIMEOUT_MS + 3_000;
// server.close() waits for every in-flight request, and an open SSE stream or
// a slow client transfer is one closeIdleConnections cannot reap — unbounded,
// this phase ate the whole 85s clock and starved the pool of its drain window
// (~2 force-exits/week, #4177). After this budget the remaining connections
// are severed; the retiring color is already off the load balancer, so the
// only requests cut are ones that would die at the hard exit anyway.
export const HTTP_CLOSE_BUDGET_MS = 2_000;

let shuttingDown = false;

export function resetGracefulShutdownStateForTesting(): void {
  shuttingDown = false;
}

type DrainPhase = 'HTTP server' | 'Conversion pool' | 'Database pool';

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

  await timedPhase('HTTP server', async () => {
    server.closeIdleConnections?.();
    const closed = new Promise<void>((resolve) =>
      server.close(() => resolve())
    );
    const closeBudget = setTimeout(() => {
      console.warn(
        `HTTP close exceeded ${HTTP_CLOSE_BUDGET_MS}ms — severing remaining connections`
      );
      server.closeAllConnections?.();
    }, HTTP_CLOSE_BUDGET_MS);
    closeBudget.unref();
    await closed;
    clearTimeout(closeBudget);
  });

  phase = 'Conversion pool';
  await timedPhase('Conversion pool', async () => {
    try {
      await shutdownConversionPool({ timeoutMs: POOL_DRAIN_TIMEOUT_MS });
    } catch (err) {
      console.error('Conversion pool drain failed:', err);
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
