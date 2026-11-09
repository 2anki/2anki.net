import fs from 'fs';
import os from 'os';
import path from 'path';

import { RECOVERY_TOO_LARGE_MESSAGE, unpack, UnpackLimits } from './unpack';

describe('unpack', () => {
  let scripts: string;
  let workspace: string;
  let archive: string;

  function fakeTar(body: string): string {
    const script = path.join(scripts, 'tar.sh');
    fs.writeFileSync(script, `#!/bin/sh\n${body}\n`, { mode: 0o755 });
    return script;
  }

  function limits(overrides: Partial<UnpackLimits>): UnpackLimits {
    return {
      tarPath: '/bin/false',
      maxBytes: 1_000_000,
      timeoutMs: 20_000,
      checkIntervalMs: 10,
      ...overrides,
    };
  }

  beforeEach(() => {
    scripts = fs.mkdtempSync(path.join(os.tmpdir(), 'unpack-scripts-'));
    workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'unpack-workspace-'));
    archive = path.join(workspace, 'upload-copy');
    fs.writeFileSync(archive, 'the uploaded archive');
  });

  afterEach(() => {
    fs.rmSync(scripts, { recursive: true, force: true });
    fs.rmSync(workspace, { recursive: true, force: true });
  });

  it('returns what was extracted, without its own temp files, even when the tool exits with an error', async () => {
    const tarPath = fakeTar('printf hello > page.html\nexit 1');

    const files = await unpack(archive, workspace, limits({ tarPath }));

    expect(files.map((f) => path.basename(f.name))).toEqual(['page.html']);
    expect(files[0].size).toBe(5);
    expect(files[0].contents).toEqual(new Uint8Array(Buffer.from('hello')));
  });

  it('stops the tool and removes its output once the extracted size passes the budget', async () => {
    const tarPath = fakeTar('head -c 5000 /dev/zero > big.bin\nexec sleep 30');

    await expect(
      unpack(archive, workspace, limits({ tarPath, maxBytes: 1000 }))
    ).rejects.toThrow(RECOVERY_TOO_LARGE_MESSAGE);

    expect(fs.existsSync(workspace)).toBe(false);
  });

  it('rejects output over the budget that finishes between size checks', async () => {
    const tarPath = fakeTar('head -c 5000 /dev/zero > big.bin');

    await expect(
      unpack(
        archive,
        workspace,
        limits({ tarPath, maxBytes: 1000, checkIntervalMs: 60_000 })
      )
    ).rejects.toThrow(RECOVERY_TOO_LARGE_MESSAGE);

    expect(fs.existsSync(workspace)).toBe(false);
  });

  it('does not count the uploaded archive against the budget', async () => {
    const tarPath = fakeTar('printf hi > page.html');
    fs.writeFileSync(archive, Buffer.alloc(5000));

    const files = await unpack(
      archive,
      workspace,
      limits({ tarPath, maxBytes: 1000 })
    );

    expect(files.map((f) => path.basename(f.name))).toEqual(['page.html']);
  });

  it('stops a tool that runs past the deadline', async () => {
    const tarPath = fakeTar('exec sleep 30');

    await expect(
      unpack(archive, workspace, limits({ tarPath, timeoutMs: 100 }))
    ).rejects.toThrow(RECOVERY_TOO_LARGE_MESSAGE);
  });

  it('rejects when the tool cannot start', async () => {
    await expect(
      unpack(
        archive,
        workspace,
        limits({ tarPath: path.join(scripts, 'missing') })
      )
    ).rejects.toMatchObject({ code: 'ENOENT' });
  });
});
