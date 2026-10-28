import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const repoRoot = path.join(__dirname, '..', '..');
const CHECK_SCRIPT = path.join(repoRoot, 'scripts', 'check.sh');

function runCheck(failingLeg: string | null) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'check-script-'));
  try {
    const fakePnpm = path.join(dir, 'fake-pnpm');
    fs.writeFileSync(
      fakePnpm,
      `#!/usr/bin/env bash\nif [ "$*" = "${failingLeg ?? ''}" ]; then exit 2; fi\nexit 0\n`,
      { mode: 0o755 }
    );
    const run = spawnSync('bash', [CHECK_SCRIPT], {
      encoding: 'utf8',
      env: { PATH: process.env.PATH, PNPM: fakePnpm },
    });
    return { status: run.status, stderr: run.stderr };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

describe('scripts/check.sh', () => {
  it('passes when every leg passes', () => {
    expect(runCheck(null)).toEqual({ status: 0, stderr: '' });
  });

  it.each([
    'typecheck',
    'arch',
    '--filter 2anki-web typecheck',
    '--filter 2anki-web test:run',
    '--filter 2anki-web lint',
  ])('fails and names the leg when %s fails', (leg) => {
    const run = runCheck(leg);

    expect(run.status).toBe(1);
    expect(run.stderr).toBe(`check: FAILED, pnpm ${leg}\n`);
  });
});
