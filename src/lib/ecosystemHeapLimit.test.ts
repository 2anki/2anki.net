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
