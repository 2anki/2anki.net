import { vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  DIR_ENTRIES_CAP,
  ensureUploadBytes,
  SNAPSHOT_MAX_BYTES,
} from './ensureUploadBytes';
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
    fs.rmSync(path.dirname(tmpPath), { recursive: true, force: true });
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

  it('collapses a batch of unreadable files into a single warn', () => {
    fs.rmSync(tmpPath);
    const gone = path.join(path.dirname(tmpPath), 'gone-too.bin');
    const files = [
      makeFile({ path: tmpPath }),
      makeFile({ path: gone, originalname: 'other.html' }),
    ];
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    ensureUploadBytes(files);

    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith(
      '[upload] could not snapshot upload bytes',
      expect.objectContaining({
        count: 2,
        total: 2,
        firstFile: path.basename(tmpPath),
      })
    );
    warn.mockRestore();
  });

  it('reports the upload directory state when a file is missing', () => {
    fs.rmSync(tmpPath);
    fs.writeFileSync(path.join(path.dirname(tmpPath), 'sibling.bin'), 'x');
    const file = makeFile({ path: tmpPath, size: 1234 });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const request = {
      complete: true,
      readableEnded: true,
      aborted: false,
      destroyed: true,
      headersSent: false,
    };
    ensureUploadBytes([file], request);

    expect(warn).toHaveBeenCalledWith(
      '[upload] could not snapshot upload bytes',
      expect.objectContaining({
        count: 1,
        total: 1,
        firstSize: 1234,
        firstCode: 'ENOENT',
        dirExists: true,
        dirEntries: 1,
        dirEntriesCapped: false,
        dirError: null,
        request,
      })
    );
    warn.mockRestore();
  });

  it('caps the directory count so a huge upload directory is not listed in full', () => {
    fs.rmSync(tmpPath);
    const dir = path.dirname(tmpPath);
    for (let i = 0; i < DIR_ENTRIES_CAP + 5; i += 1) {
      fs.writeFileSync(path.join(dir, `entry-${i}`), '');
    }
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    ensureUploadBytes([makeFile({ path: tmpPath })]);

    expect(warn).toHaveBeenCalledWith(
      '[upload] could not snapshot upload bytes',
      expect.objectContaining({
        dirEntries: DIR_ENTRIES_CAP,
        dirEntriesCapped: true,
      })
    );
    warn.mockRestore();
  });

  it('reports a listing failure on a directory that exists as its own code', () => {
    fs.rmSync(tmpPath);
    const file = makeFile({ path: tmpPath });
    const opendir = vi.spyOn(fs, 'opendirSync').mockImplementation(() => {
      throw Object.assign(new Error('EACCES: permission denied'), {
        code: 'EACCES',
      });
    });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    ensureUploadBytes([file]);

    expect(warn).toHaveBeenCalledWith(
      '[upload] could not snapshot upload bytes',
      expect.objectContaining({
        dirExists: true,
        dirEntries: null,
        dirError: 'EACCES',
      })
    );
    warn.mockRestore();
    opendir.mockRestore();
  });

  it('reports a vanished upload directory as dirExists false', () => {
    const dir = path.dirname(tmpPath);
    fs.rmSync(dir, { recursive: true, force: true });
    const file = makeFile({ path: tmpPath });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    ensureUploadBytes([file]);

    expect(warn).toHaveBeenCalledWith(
      '[upload] could not snapshot upload bytes',
      expect.objectContaining({
        dirExists: false,
        dirEntries: null,
        dirError: 'ENOENT',
      })
    );
    warn.mockRestore();
  });
});
