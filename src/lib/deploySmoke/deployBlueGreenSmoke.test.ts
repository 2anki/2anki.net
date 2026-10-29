import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const REPO_ROOT = path.resolve(__dirname, '../../..');
const DEPLOY_SCRIPT = path.join(REPO_ROOT, 'scripts/deploy-blue-green.sh');

function dryRun(currentColor: string): string {
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'blue-green-'));
  const colorFile = path.join(stateDir, 'deploy_color');
  fs.writeFileSync(colorFile, currentColor);
  try {
    const run = spawnSync('bash', [DEPLOY_SCRIPT], {
      encoding: 'utf8',
      env: {
        PATH: process.env.PATH,
        HOME: stateDir,
        DRY_RUN: '1',
        GIT_SHA: 'test-sha',
        SERVER_DIR: REPO_ROOT,
        DEPLOY_COLOR_FILE: colorFile,
        DEPLOY_LOCK_FILE: path.join(stateDir, 'deploy.lock'),
      },
    });
    expect(run.status).toBe(0);
    return run.stderr;
  } finally {
    fs.rmSync(stateDir, { recursive: true, force: true });
  }
}

describe('deploy-blue-green.sh smoke step', () => {
  it.each([
    ['blue', '3001'],
    ['green', '3000'],
  ])(
    'smoke-checks the next color on its own port before Apache is pointed at it (live %s)',
    (currentColor, nextPort) => {
      const log = dryRun(currentColor);

      const smoke = log.indexOf(
        `DRY_RUN: smoke check http://127.0.0.1:${nextPort}`
      );
      const swap = log.indexOf('DRY_RUN: sudo apachectl graceful');
      expect(smoke).toBeGreaterThan(-1);
      expect(swap).toBeGreaterThan(smoke);
    }
  );
});

describe('deploy-blue-green.sh dry run', () => {
  it('pipes nothing into run, which drops its input in a dry run and lets printf die of SIGPIPE', () => {
    const script = fs.readFileSync(DEPLOY_SCRIPT, 'utf8');

    expect(script.match(/\|\s*run\b/g) ?? []).toEqual([]);
  });

  it('logs both upstream files it would write', () => {
    const log = dryRun('blue');

    expect(log.match(/DRY_RUN: sudo tee \S+\.new/g)).toHaveLength(2);
  });
});

function envCheck(check: string, environ: string): boolean {
  const script = fs.readFileSync(DEPLOY_SCRIPT, 'utf8');
  const helpers = script
    .split('\n')
    .filter((line) => /^(has_heap_ceiling|has_arena_cap)\(\)/.test(line))
    .join('\n');
  const run = spawnSync(
    'bash',
    ['-c', `set -euo pipefail\n${helpers}\n${check} "$ENVIRON"`],
    { encoding: 'utf8', env: { PATH: process.env.PATH, ENVIRON: environ } }
  );
  return run.status === 0;
}

describe('deploy-blue-green.sh environment checks', () => {
  // Larger than a pipe buffer, so a piped early-exiting reader could SIGPIPE
  // the writer before it finished (#5120).
  const filler = Array.from(
    { length: 4000 },
    (_, i) => `VAR_${i}=${'x'.repeat(40)}`
  );

  it('pipes the process environment into no early-exiting reader', () => {
    const script = fs.readFileSync(DEPLOY_SCRIPT, 'utf8');

    expect(script.match(/\|\s*(grep\s+-\w*q|head)\b/g) ?? []).toEqual([]);
  });

  it.each([
    ['first', ['NODE_OPTIONS=--max-old-space-size=6144', ...filler]],
    ['last', [...filler, 'NODE_OPTIONS=--max-old-space-size=6144']],
  ])(
    'finds the heap ceiling in a large environment when it comes %s',
    (_where, lines) => {
      expect(envCheck('has_heap_ceiling', lines.join('\n'))).toBe(true);
    }
  );

  it('reports a missing heap ceiling', () => {
    expect(envCheck('has_heap_ceiling', filler.join('\n'))).toBe(false);
  });

  it.each([
    ['first', ['MALLOC_ARENA_MAX=2', ...filler], true],
    ['last', [...filler, 'MALLOC_ARENA_MAX=2'], true],
    ['with a different value', [...filler, 'MALLOC_ARENA_MAX=20'], false],
    ['missing', filler, false],
  ])(
    'matches the arena cap as a whole line when it is %s',
    (_where, lines, expected) => {
      expect(envCheck('has_arena_cap', (lines as string[]).join('\n'))).toBe(
        expected
      );
    }
  );
});
