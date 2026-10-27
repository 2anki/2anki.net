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
