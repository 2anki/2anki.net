import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const REPO_ROOT = path.resolve(__dirname, '../../..');
const RESTORE_SCRIPT = path.join(
  REPO_ROOT,
  'scripts/deploy-restore-last-good.sh'
);

function isolatedGitEnv(home: string): NodeJS.ProcessEnv {
  return {
    PATH: process.env.PATH,
    HOME: home,
    GIT_CONFIG_GLOBAL: '/dev/null',
    GIT_CONFIG_NOSYSTEM: '1',
  };
}

describe('deploy-restore-last-good.sh migration log', () => {
  let root: string;
  let repo: string;

  function git(...args: string[]): string {
    const run = spawnSync(
      'git',
      [
        '-c',
        'user.name=test',
        '-c',
        'user.email=test@example.com',
        '-c',
        'commit.gpgsign=false',
        ...args,
      ],
      { cwd: repo, encoding: 'utf8', env: isolatedGitEnv(root) }
    );
    expect(run.status).toBe(0);
    return run.stdout.trim();
  }

  function commitFiles(files: Record<string, string | null>): string {
    for (const [name, content] of Object.entries(files)) {
      const target = path.join(repo, name);
      if (content === null) {
        fs.rmSync(target);
      } else {
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.writeFileSync(target, content);
      }
    }
    git('add', '-A');
    git('commit', '-q', '-m', 'step');
    return git('rev-parse', 'HEAD');
  }

  function restore(lastGood: string): string {
    const bin = path.join(root, 'bin');
    fs.mkdirSync(bin);
    fs.writeFileSync(path.join(bin, 'pnpm'), '#!/bin/sh\nexit 0\n', {
      mode: 0o755,
    });
    const lastGoodFile = path.join(root, 'last_good');
    fs.writeFileSync(lastGoodFile, `${lastGood}\n`);
    const isolated = isolatedGitEnv(root);
    const run = spawnSync('bash', [RESTORE_SCRIPT], {
      encoding: 'utf8',
      env: {
        ...isolated,
        PATH: `${bin}:${isolated.PATH}`,
        SERVER_DIR: repo,
        DEPLOY_LAST_GOOD_FILE: lastGoodFile,
      },
    });
    expect(run.status).toBe(0);
    return run.stderr;
  }

  function lineWith(log: string, needle: string): string | undefined {
    return log.split('\n').find((line) => line.includes(needle));
  }

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'restore-last-good-'));
    repo = path.join(root, 'repo');
    fs.mkdirSync(repo);
    git('init', '-q');
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('names the migrations added since last-good that it leaves applied, before checking out last-good', () => {
    const lastGood = commitFiles({
      'migrations/20260101000000_old.js': 'old',
    });
    commitFiles({
      'migrations/20260101000000_old.js': 'old, edited',
      'migrations/20260102000000_new.js': 'new',
      'src/unrelated.ts': 'x',
    });

    const log = restore(lastGood);

    const leftApplied = lineWith(log, 'leaving applied');
    expect(leftApplied).toContain('migrations/20260102000000_new.js');
    expect(leftApplied).not.toContain('20260101000000_old.js');
    expect(log.indexOf('leaving applied')).toBeLessThan(
      log.indexOf('disk restored to last-good')
    );
    expect(git('rev-parse', 'HEAD')).toBe(lastGood);
  });

  it('names a migration renamed since last-good under its new name', () => {
    const lastGood = commitFiles({
      'migrations/20260101000000_old.js': 'same content for rename detection',
    });
    commitFiles({
      'migrations/20260101000000_old.js': null,
      'migrations/20260103000000_renamed.js':
        'same content for rename detection',
    });

    const log = restore(lastGood);

    expect(lineWith(log, 'leaving applied')).toContain(
      'migrations/20260103000000_renamed.js'
    );
  });

  it('says no migrations were added when last-good already has every migration file', () => {
    const lastGood = commitFiles({
      'migrations/20260101000000_old.js': 'old',
    });
    commitFiles({ 'src/unrelated.ts': 'x' });

    const log = restore(lastGood);

    expect(log).toContain('no migrations added since last-good');
    expect(log).not.toContain('leaving applied');
  });

  it('refuses a last-good value that is not a commit sha, without claiming no migrations were added', () => {
    commitFiles({ 'migrations/20260101000000_old.js': 'old' });
    const head = commitFiles({ 'src/unrelated.ts': 'x' });

    const log = restore('--output=/tmp/should-not-exist');

    expect(log).toContain('is not a commit sha');
    expect(log).not.toContain('no migrations added since last-good');
    expect(git('rev-parse', 'HEAD')).toBe(head);
  });

  it('says it could not list migrations when last-good is not in the repository', () => {
    commitFiles({ 'migrations/20260101000000_old.js': 'old' });
    commitFiles({ 'src/unrelated.ts': 'x' });

    const log = restore('0123456789abcdef0123456789abcdef01234567');

    expect(log).toContain('could not list migrations added since last-good');
    expect(log).not.toContain('no migrations added since last-good');
  });
});
