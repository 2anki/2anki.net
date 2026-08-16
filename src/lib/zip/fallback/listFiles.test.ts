import fs from 'fs';
import os from 'os';
import path from 'path';

import { listFiles } from './listFiles';

describe('listFiles', () => {
  let workspace: string;
  let outside: string;

  beforeEach(async () => {
    workspace = await fs.promises.mkdtemp(
      path.join(os.tmpdir(), 'unpack-test-')
    );
    outside = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'secret-'));
    await fs.promises.writeFile(path.join(outside, 'secret.txt'), 'top secret');
  });

  afterEach(async () => {
    await fs.promises.rm(workspace, { recursive: true, force: true });
    await fs.promises.rm(outside, { recursive: true, force: true });
  });

  it('collects regular files, including nested ones', async () => {
    await fs.promises.writeFile(path.join(workspace, 'a.md'), 'alpha');
    await fs.promises.mkdir(path.join(workspace, 'sub'));
    await fs.promises.writeFile(path.join(workspace, 'sub', 'b.md'), 'beta');

    const files = await listFiles(workspace);

    expect(files.map((f) => path.basename(f.name)).sort()).toEqual([
      'a.md',
      'b.md',
    ]);
  });

  it('never follows a symlink out of the workspace', async () => {
    await fs.promises.writeFile(path.join(workspace, 'a.md'), 'alpha');
    await fs.promises.symlink(
      path.join(outside, 'secret.txt'),
      path.join(workspace, 'link.md')
    );

    const files = await listFiles(workspace);

    expect(files.map((f) => path.basename(f.name))).toEqual(['a.md']);
    const contents = files.map((f) => Buffer.from(f.contents ?? []).toString());
    expect(contents.join('')).not.toContain('top secret');
  });

  it('never follows a symlinked directory out of the workspace', async () => {
    await fs.promises.symlink(
      outside,
      path.join(workspace, 'linked-dir'),
      'dir'
    );

    const files = await listFiles(workspace);

    expect(files).toEqual([]);
  });
});
