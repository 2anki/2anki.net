import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const repoRoot = path.join(__dirname, '..', '..');
const ARCH_SCRIPT = path.join(repoRoot, 'scripts', 'arch.sh');

const MISSING_TSC = `✔ no dependency violations found (0 modules, 0 dependencies cruised)

‼ missing-tsc-transpiler: dependency-cruiser detected a TypeScript environment,
    but not a compatible TypeScript compiler (typescript: >=2.0.0 <7.0.0).`;

function runArch(depcruiseOutput: string, depcruiseStatus = 0) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'arch-script-'));
  try {
    fs.mkdirSync(path.join(dir, 'src'));
    spawnSync('git', ['init', '-q'], { cwd: dir });
    const outputFile = path.join(dir, 'depcruise-output.txt');
    fs.writeFileSync(outputFile, depcruiseOutput);
    const fakeDepcruise = path.join(dir, 'fake-depcruise');
    fs.writeFileSync(
      fakeDepcruise,
      `#!/usr/bin/env bash\ncat "${outputFile}"\nexit ${depcruiseStatus}\n`,
      { mode: 0o755 }
    );
    const run = spawnSync('bash', [ARCH_SCRIPT], {
      cwd: dir,
      encoding: 'utf8',
      env: { PATH: process.env.PATH, DEPCRUISE: fakeDepcruise },
    });
    return { status: run.status, stderr: run.stderr };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

describe('scripts/arch.sh', () => {
  it('fails when dependency-cruiser has no TypeScript compiler it supports', () => {
    const run = runArch(MISSING_TSC);

    expect(run.status).toBe(1);
    expect(run.stderr).toContain('found no TypeScript compiler it supports');
  });

  it('fails when dependency-cruiser cruised 0 modules', () => {
    const run = runArch(
      '✔ no dependency violations found (0 modules, 0 dependencies cruised)'
    );

    expect(run.status).toBe(1);
    expect(run.stderr).toContain('cruised 0 modules');
  });

  it('fails when dependency-cruiser printed no module count', () => {
    const run = runArch('');

    expect(run.status).toBe(1);
    expect(run.stderr).toContain('printed no module count');
  });

  it('passes a run that cruised modules and found only warnings', () => {
    const run = runArch(
      'x 299 dependency violations (0 errors, 299 warnings). 1210 modules, 3723 dependencies cruised.'
    );

    expect(run).toEqual({ status: 0, stderr: '' });
  });

  it('keeps the dependency-cruiser exit code when a rule errors', () => {
    const run = runArch(
      'x 1 dependency violations (1 errors, 0 warnings). 1215 modules, 3723 dependencies cruised.',
      1
    );

    expect(run.status).toBe(1);
  });
});
