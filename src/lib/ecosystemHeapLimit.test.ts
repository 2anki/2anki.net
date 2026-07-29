import path from 'node:path';

// The blue-green ecosystem config is what scripts/deploy-blue-green.sh feeds to
// `pm2 start`, so it is the only place the production heap ceiling is declared.
// On 2026-07-29 the ceiling was declared via node_args alone; pm2 stored it but
// never put it on the spawned command line, so the process ran at node's ~4144MB
// default and the main thread OOM-crashed at 4189MB. NODE_OPTIONS in the app env
// is the channel that actually reaches V8 before it sizes the heap.
const config = require(
  path.resolve(__dirname, '../../ecosystem.blue-green.config.js')
) as {
  apps: Array<{
    name: string;
    node_args?: string;
    max_memory_restart?: string;
    kill_timeout?: number;
    env: Record<string, unknown>;
  }>;
};

const HEAP_FLAG = /--max-old-space-size=(\d+)/;

describe('blue-green ecosystem config — heap ceiling', () => {
  it('declares both colors', () => {
    expect(config.apps.map((app) => app.name).sort()).toEqual([
      'server-blue',
      'server-green',
    ]);
  });

  it.each(['server-blue', 'server-green'])(
    'sets NODE_OPTIONS heap ceiling for %s so V8 sees it before boot',
    (name) => {
      const app = config.apps.find((candidate) => candidate.name === name)!;
      const nodeOptions = app.env.NODE_OPTIONS;

      expect(typeof nodeOptions).toBe('string');
      expect(nodeOptions as string).toMatch(HEAP_FLAG);
    }
  );

  it.each(['server-blue', 'server-green'])(
    'raises %s well above node default so a 4144MB ceiling cannot return',
    (name) => {
      const app = config.apps.find((candidate) => candidate.name === name)!;
      const megabytes = Number.parseInt(
        HEAP_FLAG.exec(app.env.NODE_OPTIONS as string)![1],
        10
      );

      expect(megabytes).toBeGreaterThanOrEqual(8192);
    }
  );

  it('keeps node_args and NODE_OPTIONS on the same value so they cannot drift', () => {
    for (const app of config.apps) {
      expect(app.node_args).toBe(app.env.NODE_OPTIONS);
    }
  });
});

// Raising the ceiling only lengthens the fuse on an unbounded leak (#3926), so
// pm2 recycles the process gracefully before V8 dies. The threshold has to stay
// on the right side of two boundaries at once — high enough that ordinary load
// never trips it, low enough that it beats the hard OOM.
describe('blue-green ecosystem config — graceful memory recycle', () => {
  const GIGABYTE_MB = 1024;

  it.each(['server-blue', 'server-green'])(
    'sets a max_memory_restart threshold for %s',
    (name) => {
      const app = config.apps.find((candidate) => candidate.name === name)!;
      expect(app.max_memory_restart).toMatch(/^\d+G$/);
    }
  );

  it.each(['server-blue', 'server-green'])(
    'keeps %s recycling before V8 can hit the heap wall',
    (name) => {
      const app = config.apps.find((candidate) => candidate.name === name)!;
      const thresholdMb =
        Number.parseInt(app.max_memory_restart!.replace('G', ''), 10) *
        GIGABYTE_MB;
      const ceilingMb = Number.parseInt(
        HEAP_FLAG.exec(app.env.NODE_OPTIONS as string)![1],
        10
      );

      // max_memory_restart measures RSS; the ceiling caps the heap, and RSS is
      // never smaller than the heap it contains. So a threshold at or under the
      // ceiling is guaranteed to trip first, which is the whole point — a
      // graceful drain instead of a FATAL ERROR. Set it above the ceiling and
      // V8 wins the race and the recycle never runs, silently disabling itself.
      expect(thresholdMb).toBeLessThanOrEqual(ceilingMb);
    }
  );

  it.each(['server-blue', 'server-green'])(
    'leaves %s room for the drain to finish before pm2 escalates',
    (name) => {
      const app = config.apps.find((candidate) => candidate.name === name)!;
      // A recycle is only better than an OOM if in-flight conversions actually
      // drain; kill_timeout must outlast SHUTDOWN_TIMEOUT_MS (85s).
      expect(app.kill_timeout).toBeGreaterThan(85_000);
    }
  );
});
