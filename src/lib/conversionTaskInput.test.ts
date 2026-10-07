import { vi } from 'vitest';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  clearStaleConversionTaskDirs,
  conversionTaskBase,
  pinConversionTaskInput,
} from './conversionTaskInput';
import type { UploadedFile } from './storage/types';
import type { UploadGenerationTask } from '../usecases/uploads/uploadGenerationTypes';

function makeFile(overrides: Partial<UploadedFile>): UploadedFile {
  return {
    fieldname: 'file',
    originalname: 'notes.html',
    encoding: '7bit',
    mimetype: 'text/html',
    size: 0,
    destination: '',
    filename: 'notes.html',
    path: '',
    key: 'notes.html',
    buffer: undefined as never,
    stream: null as never,
    ...overrides,
  };
}

function taskWith(files: UploadedFile[]): UploadGenerationTask {
  return {
    paying: false,
    files,
    settings: {} as never,
    workspace: {} as never,
    enqueuedAt: 0,
    userId: null,
  };
}

describe('pinConversionTaskInput', () => {
  let scratch: string;

  beforeEach(async () => {
    scratch = await fsp.mkdtemp(path.join(os.tmpdir(), 'pin-src-'));
  });

  afterEach(async () => {
    await fsp.rm(scratch, { recursive: true, force: true });
  });

  it('hardlinks a disk-backed upload into the task dir and drops the buffer', async () => {
    const src = path.join(scratch, 'disk.html');
    await fsp.writeFile(src, '<html>disk</html>');
    const pinned = await pinConversionTaskInput(
      taskWith([makeFile({ path: src, originalname: 'disk.html' })])
    );

    const file = pinned.task.files[0];
    expect(file.path).not.toBe(src);
    expect(file.path.startsWith(conversionTaskBase())).toBe(true);
    expect(file.buffer).toBeUndefined();
    expect(fs.readFileSync(file.path, 'utf8')).toBe('<html>disk</html>');

    await pinned.cleanup();
    expect(fs.existsSync(file.path)).toBe(false);
  });

  it('falls back to copy when linking throws (cross-device)', async () => {
    const src = path.join(scratch, 'xdev.html');
    await fsp.writeFile(src, '<html>xdev</html>');
    const linkSpy = vi
      .spyOn(fsp, 'link')
      .mockRejectedValueOnce(
        Object.assign(new Error('EXDEV'), { code: 'EXDEV' })
      );

    const pinned = await pinConversionTaskInput(
      taskWith([makeFile({ path: src, originalname: 'xdev.html' })])
    );
    const file = pinned.task.files[0];
    expect(fs.readFileSync(file.path, 'utf8')).toBe('<html>xdev</html>');

    linkSpy.mockRestore();
    await pinned.cleanup();
  });

  it('writes a buffer-only upload to disk and clears the buffer', async () => {
    const pinned = await pinConversionTaskInput(
      taskWith([
        makeFile({
          path: '',
          buffer: Buffer.from('<html>mem</html>') as never,
          originalname: 'mem.html',
        }),
      ])
    );
    const file = pinned.task.files[0];
    expect(file.buffer).toBeUndefined();
    expect(fs.readFileSync(file.path, 'utf8')).toBe('<html>mem</html>');
    await pinned.cleanup();
    expect(fs.existsSync(file.path)).toBe(false);
  });
});

describe('clearStaleConversionTaskDirs', () => {
  it('removes task dirs older than the cutoff and keeps fresh ones', async () => {
    const base = conversionTaskBase();
    await fsp.mkdir(base, { recursive: true });
    const stale = path.join(base, 'stale-dir-test');
    const fresh = path.join(base, 'fresh-dir-test');
    await fsp.mkdir(stale, { recursive: true });
    await fsp.mkdir(fresh, { recursive: true });
    const old = new Date(Date.now() - 48 * 60 * 60 * 1000);
    await fsp.utimes(stale, old, old);

    const removed = await clearStaleConversionTaskDirs(24 * 60 * 60 * 1000);

    expect(removed).toBeGreaterThanOrEqual(1);
    expect(fs.existsSync(stale)).toBe(false);
    expect(fs.existsSync(fresh)).toBe(true);

    await fsp.rm(fresh, { recursive: true, force: true });
  });
});
