import { describe, expect, it } from 'vitest';
import {
  assertFilesReadable,
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
      assertFilesReadable([new File(['a'], 'a.txt'), new File([], 'empty.txt')])
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
  });
});
