import { describe, expect, it } from 'vitest';
import {
  assertFilesReadable,
  snapshotUploadBody,
  SNAPSHOT_MAX_BYTES,
  UnreadableFileError,
} from './assertFilesReadable';

function unreadable(name: string): File {
  const file = new File(['x'], name);
  Object.defineProperty(file, 'slice', {
    value: () => ({
      arrayBuffer: () =>
        Promise.reject(
          new DOMException(
            'The requested file could not be read',
            'NotReadableError'
          )
        ),
    }),
  });
  return file;
}

describe('assertFilesReadable', () => {
  it('resolves when every file can be read', async () => {
    await expect(
      assertFilesReadable([new File(['a'], 'a.txt'), new File(['b'], 'b.txt')])
    ).resolves.toBeUndefined();
  });

  it('rejects a 0-byte pick as empty before touching the disk', async () => {
    const empty = new File([], 'placeholder.pdf');
    const error = await assertFilesReadable([empty]).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(UnreadableFileError);
    expect((error as UnreadableFileError).file).toBe(empty);
    expect((error as UnreadableFileError).reason).toBe('empty');
  });

  it('lets a batch through when an empty companion sits beside real content', async () => {
    await expect(
      assertFilesReadable([new File(['a'], 'a.txt'), new File([], 'stray.md')])
    ).resolves.toBeUndefined();
  });

  it('throws an UnreadableFileError naming the file the browser refuses', async () => {
    const stale = unreadable('notes.zip');
    const error = await assertFilesReadable([
      new File(['a'], 'a.txt'),
      stale,
    ]).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(UnreadableFileError);
    expect((error as UnreadableFileError).file).toBe(stale);
    expect((error as UnreadableFileError).reason).toBe('changed');
  });
});

function unreadableWhole(name: string): File {
  const file = new File(['abc'], name);
  Object.defineProperty(file, 'arrayBuffer', {
    value: () =>
      Promise.reject(
        new DOMException(
          'The requested file could not be read',
          'NotReadableError'
        )
      ),
  });
  return file;
}

describe('snapshotUploadBody', () => {
  it('sends in-memory copies of the files with the same names, types and fields', async () => {
    const original = new File(['hello'], 'notes.md', { type: 'text/markdown' });
    const form = new FormData();
    form.append('claude-ai-flashcards', 'false');
    form.append('pakker', original);

    const snapshot = await snapshotUploadBody(form, [original]);

    expect(snapshot.get('claude-ai-flashcards')).toBe('false');
    const sent = snapshot.get('pakker') as File;
    expect(sent).not.toBe(original);
    expect(sent.name).toBe('notes.md');
    expect(sent.type).toBe('text/markdown');
    expect(await sent.text()).toBe('hello');
  });

  it('names a file the browser cannot read to the end, though its first byte reads', async () => {
    const partial = unreadableWhole('cloud.pdf');
    const form = new FormData();
    form.append('pakker', partial);

    const error = await snapshotUploadBody(form, [partial]).catch(
      (e: unknown) => e
    );

    expect(error).toBeInstanceOf(UnreadableFileError);
    expect((error as UnreadableFileError).file).toBe(partial);
    expect((error as UnreadableFileError).reason).toBe('partial');
  });

  it('streams files above the in-memory cap from disk as before', async () => {
    const big = new File(['abc'], 'big.zip');
    Object.defineProperty(big, 'size', { value: SNAPSHOT_MAX_BYTES + 1 });
    const form = new FormData();
    form.append('pakker', big);

    const snapshot = await snapshotUploadBody(form, [big]);

    expect(snapshot.get('pakker')).toBe(big);
  });

  it('still refuses a pick with no content', async () => {
    const empty = new File([], 'placeholder.pdf');
    const form = new FormData();
    form.append('pakker', empty);

    const error = await snapshotUploadBody(form, [empty]).catch(
      (e: unknown) => e
    );

    expect((error as UnreadableFileError).reason).toBe('empty');
  });
});
