import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const REPO_ROOT = path.resolve(__dirname, '../../..');
const RESTORE_SCRIPT = path.join(
  REPO_ROOT,
  'scripts/deploy-restore-last-good.sh'
);

function git(cwd: string, ...args: string[]): string {
  const run = spawnSync(
    'git',
    ['-c', 'user.name=test', '-c', 'user.email=test@example.com', ...args],
    { cwd, encoding: 'utf8' }
  );
  expect(run.status).toBe(0);
  return run.stdout.trim();
}

function commitFiles(repo: string, files: Record<string, string>): string {
  for (const [name, content] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(repo, name)), { recursive: true });
    fs.writeFileSync(path.join(repo, name), content);
  }
  git(repo, 'add', '-A');
  git(repo, 'commit', '-q', '-m', 'step');
  return git(repo, 'rev-parse', 'HEAD');
}

describe('deploy-restore-last-good.sh migration log', () => {
  let root: string;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'restore-last-good-'));
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  function restore(repo: string, lastGood: string) {
    const bin = path.join(root, 'bin');
    fs.mkdirSync(bin);
    fs.writeFileSync(path.join(bin, 'pnpm'), '#!/bin/sh\nexit 0\n', {
      mode: 0o755,
    });
    const lastGoodFile = path.join(root, 'last_good');
    fs.writeFileSync(lastGoodFile, `${lastGood}\n`);
    const run = spawnSync('bash', [RESTORE_SCRIPT], {
      encoding: 'utf8',
      env: {
        PATH: `${bin}:${process.env.PATH}`,
        HOME: root,
        SERVER_DIR: repo,
        DEPLOY_LAST_GOOD_FILE: lastGoodFile,
      },
    });
    expect(run.status).toBe(0);
    return run.stderr;
  }

  it('names the migrations added since last-good that it leaves applied, before checking out last-good', () => {
    const repo = path.join(root, 'repo');
    fs.mkdirSync(repo);
    git(repo, 'init', '-q');
    const lastGood = commitFiles(repo, {
      'migrations/20260101000000_old.js': 'old',
    });
    commitFiles(repo, {
      'migrations/20260101000000_old.js': 'old, edited',
      'migrations/20260102000000_new.js': 'new',
      'src/unrelated.ts': 'x',
    });

    const log = restore(repo, lastGood);

    const leftApplied = log
      .split('\n')
      .find((line) => line.includes('leaving applied'));
    expect(leftApplied).toContain('migrations/20260102000000_new.js');
    expect(leftApplied).not.toContain('20260101000000_old.js');
    expect(log.indexOf('leaving applied')).toBeLessThan(
      log.indexOf('disk restored to last-good')
    );
    expect(git(repo, 'rev-parse', 'HEAD')).toBe(lastGood);
  });

  it('says no migrations were added when last-good already has every migration file', () => {
    const repo = path.join(root, 'repo');
    fs.mkdirSync(repo);
    git(repo, 'init', '-q');
    const lastGood = commitFiles(repo, {
      'migrations/20260101000000_old.js': 'old',
    });
    commitFiles(repo, { 'src/unrelated.ts': 'x' });

    const log = restore(repo, lastGood);

    expect(log).toContain('no migrations added since last-good');
    expect(log).not.toContain('leaving applied');
  });
});
