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
  // The environment goes in on stdin: a single variable this large passes
  // macOS but exceeds Linux's per-string limit (MAX_ARG_STRLEN), so the
  // spawn itself would fail there.
  const run = spawnSync(
    'bash',
    [
      '-c',
      `set -euo pipefail\n${helpers}\nENVIRON="$(cat)"\n${check} "$ENVIRON"`,
    ],
    { encoding: 'utf8', env: { PATH: process.env.PATH }, input: environ }
  );
  if (run.error) throw run.error;
  return run.status === 0;
}

const EARLY_EXIT_READERS =
  /\|\s*(grep\b[^\n|]*\s(-[A-Za-z]*q[A-Za-z]*|--quiet|--silent|-m\s*\d+|--max-count)|head\b)/g;

describe('deploy-blue-green.sh environment checks', () => {
  it.each([
    "tr '\\0' '\\n' < env | grep -q -- 'x'",
    "tr '\\0' '\\n' < env | grep -qx 'MALLOC_ARENA_MAX=2'",
    'cat env | grep --quiet x',
    'cat env | grep -m 1 x',
    'cat env | head -1',
  ])('the early-exit guard catches %s', (line) => {
    expect(line.match(EARLY_EXIT_READERS)).not.toBeNull();
  });

  // A large environment, so a match at either end is exercised.
  const filler = Array.from(
    { length: 4000 },
    (_, i) => `VAR_${i}=${'x'.repeat(40)}`
  );

  it('pipes the process environment into no early-exiting reader', () => {
    const script = fs.readFileSync(DEPLOY_SCRIPT, 'utf8');

    expect(script.match(EARLY_EXIT_READERS) ?? []).toEqual([]);
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

function scriptFunction(script: string, name: string): string {
  const oneLine = new RegExp(`^${name}\\(\\) \\{.*\\}$`, 'm').exec(script);
  if (oneLine) return oneLine[0];
  const block = new RegExp(`^${name}\\(\\) \\{\\n[\\s\\S]*?\\n\\}$`, 'm').exec(
    script
  );
  if (!block) throw new Error(`no ${name} in the deploy script`);
  return block[0];
}

function verifyNextEnv(environ: string | 'unreadable' | 'missing') {
  const procDir = fs.mkdtempSync(path.join(os.tmpdir(), 'proc-'));
  const binDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bin-'));
  const pm2Calls = path.join(binDir, 'pm2-calls');
  fs.writeFileSync(
    path.join(binDir, 'pm2'),
    `#!/usr/bin/env bash\necho "$*" >> "${pm2Calls}"\n`,
    { mode: 0o755 }
  );
  if (environ === 'unreadable') {
    // Readable as a path but fails to read, as when the process exits.
    fs.mkdirSync(path.join(procDir, '42', 'environ'), { recursive: true });
  } else if (environ !== 'missing') {
    fs.mkdirSync(path.join(procDir, '42'));
    fs.writeFileSync(path.join(procDir, '42', 'environ'), environ);
  }
  const script = fs.readFileSync(DEPLOY_SCRIPT, 'utf8');
  const helpers = [
    'log',
    'run',
    'environ_lines',
    'has_heap_ceiling',
    'has_arena_cap',
    'verify_next_env',
  ]
    .map((name) => scriptFunction(script, name))
    .join('\n');
  try {
    const run = spawnSync(
      'bash',
      [
        '-c',
        `set -euo pipefail\nDRY_RUN=0\nNEXT=green\nDEPLOY_PROC_DIR="${procDir}"\n${helpers}\nverify_next_env 42`,
      ],
      {
        encoding: 'utf8',
        env: { PATH: `${binDir}:${process.env.PATH}` },
      }
    );
    const calls = fs.existsSync(pm2Calls)
      ? fs.readFileSync(pm2Calls, 'utf8').trim()
      : '';
    return { status: run.status, log: run.stderr, pm2: calls };
  } finally {
    fs.rmSync(procDir, { recursive: true, force: true });
    fs.rmSync(binDir, { recursive: true, force: true });
  }
}

// Exit 1 here is what sends the deploy workflow to deploy-restore-last-good.sh.
describe('deploy-blue-green.sh verify_next_env', () => {
  const nul = (lines: string[]) => lines.join('\0') + '\0';

  it('passes and removes nothing when both settings are present', () => {
    const result = verifyNextEnv(
      nul(['NODE_OPTIONS=--max-old-space-size=6144', 'MALLOC_ARENA_MAX=2'])
    );

    expect(result).toMatchObject({ status: 0, pm2: '' });
  });

  it.each([
    ['the heap ceiling', nul(['MALLOC_ARENA_MAX=2'])],
    ['the arena cap', nul(['NODE_OPTIONS=--max-old-space-size=6144'])],
  ])('removes the new color and fails without %s', (_what, environ) => {
    const result = verifyNextEnv(environ);

    expect(result).toMatchObject({ status: 1, pm2: 'delete server-green' });
  });

  it('removes the new color and fails when its environment cannot be read', () => {
    const result = verifyNextEnv('unreadable');

    expect(result).toMatchObject({ status: 1, pm2: 'delete server-green' });
  });

  it('warns and goes on when the process has no readable environment file', () => {
    const result = verifyNextEnv('missing');

    expect(result.status).toBe(0);
    expect(result.pm2).toBe('');
    expect(result.log).toContain('heap ceiling unverified');
  });
});

function liveDeploy(environ: string | 'unreadable') {
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'blue-green-live-'));
  const procDir = path.join(stateDir, 'proc');
  const binDir = path.join(stateDir, 'bin');
  const pm2Calls = path.join(stateDir, 'pm2-calls');
  fs.mkdirSync(binDir);
  fs.writeFileSync(
    path.join(binDir, 'pm2'),
    `#!/usr/bin/env bash\necho "$*" >> "${pm2Calls}"\nif [ "$1" = pid ]; then echo 42; fi\n`,
    { mode: 0o755 }
  );
  if (environ === 'unreadable') {
    fs.mkdirSync(path.join(procDir, '42', 'environ'), { recursive: true });
  } else {
    fs.mkdirSync(path.join(procDir, '42'), { recursive: true });
    fs.writeFileSync(path.join(procDir, '42', 'environ'), environ);
  }
  const colorFile = path.join(stateDir, 'deploy_color');
  fs.writeFileSync(colorFile, 'blue');
  try {
    const run = spawnSync('bash', [DEPLOY_SCRIPT], {
      encoding: 'utf8',
      env: {
        PATH: `${binDir}:${process.env.PATH}`,
        HOME: stateDir,
        GIT_SHA: 'test-sha',
        SERVER_DIR: REPO_ROOT,
        DEPLOY_COLOR_FILE: colorFile,
        DEPLOY_LOCK_FILE: path.join(stateDir, 'deploy.lock'),
        DEPLOY_PROC_DIR: procDir,
      },
    });
    return {
      status: run.status,
      pm2: fs.existsSync(pm2Calls)
        ? fs.readFileSync(pm2Calls, 'utf8').trim().split('\n')
        : [],
      color: fs.readFileSync(colorFile, 'utf8').trim(),
    };
  } finally {
    fs.rmSync(stateDir, { recursive: true, force: true });
  }
}

// A real (non-dry) run stops at the environment check, before any health
// check, Apache or sudo step; its non-zero exit is what the deploy workflow
// hands to deploy-restore-last-good.sh.
describe('deploy-blue-green.sh live run when the new color is wrong', () => {
  it.each([
    ['lacks the heap ceiling', 'MALLOC_ARENA_MAX=2\0'],
    ['has an unreadable environment', 'unreadable' as const],
  ])('exits non-zero and removes the new color when it %s', (_why, environ) => {
    const result = liveDeploy(environ);

    expect(result.status).toBe(1);
    expect(result.pm2).toContain('delete server-green');
    expect(result.color).toBe('blue');
  });

  it('reads the real proc directory unless told otherwise', () => {
    const script = fs.readFileSync(DEPLOY_SCRIPT, 'utf8');

    expect(script).toContain('DEPLOY_PROC_DIR="${DEPLOY_PROC_DIR:-/proc}"');
  });
});
