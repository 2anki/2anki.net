import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ensureUploadBytes, SNAPSHOT_MAX_BYTES } from './ensureUploadBytes';
import { UploadedFile } from '../../lib/storage/types';
import { getFileContents } from './worker';

function makeFile(overrides: Partial<UploadedFile>): UploadedFile {
  return {
    originalname: 'notes.html',
    key: 'notes.html',
    ...overrides,
  } as UploadedFile;
}

describe('ensureUploadBytes', () => {
  let tmpPath: string;

  beforeEach(() => {
    tmpPath = path.join(
      fs.mkdtempSync(path.join(os.tmpdir(), 'ensure-bytes-')),
      'upload.bin'
    );
    fs.writeFileSync(tmpPath, Buffer.from('disk-bytes'));
  });

  afterEach(() => {
    if (fs.existsSync(tmpPath)) fs.rmSync(tmpPath);
  });

  it('snapshots disk bytes into buffer when the file has a path but no buffer', () => {
    const file = makeFile({ path: tmpPath });

    ensureUploadBytes([file]);

    expect(file.buffer).toEqual(Buffer.from('disk-bytes'));
  });

  it('keeps the worker readable after the temp file is reaped mid-dwell', () => {
    const file = makeFile({ path: tmpPath });

    ensureUploadBytes([file]);
    fs.rmSync(tmpPath); // simulate the OS/multer reaping UPLOAD_BASE

    // Before the fix this threw "no longer available on disk and has no buffer
    // fallback"; the snapshot keeps the conversion alive.
    expect(getFileContents(file)).toEqual(Buffer.from('disk-bytes'));
  });

  it('leaves an already-buffered upload untouched', () => {
    const existing = Buffer.from('memory-bytes');
    const file = makeFile({ buffer: existing });

    ensureUploadBytes([file]);

    expect(file.buffer).toBe(existing);
  });

  it('skips the eager snapshot for uploads over the cap, keeping the disk path', () => {
    const file = makeFile({ path: tmpPath, size: SNAPSHOT_MAX_BYTES + 1 });

    ensureUploadBytes([file]);

    expect(file.buffer).toBeUndefined();
    expect(getFileContents(file)).toEqual(Buffer.from('disk-bytes'));
  });

  it('does not throw when the file is already gone at request time', () => {
    fs.rmSync(tmpPath);
    const file = makeFile({ path: tmpPath });

    expect(() => ensureUploadBytes([file])).not.toThrow();
    expect(file.buffer).toBeUndefined();
  });
});
