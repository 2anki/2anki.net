import { describe, expect, it } from 'vitest';
import {
  collectDroppedEntries,
  hasDirectoryEntry,
  FolderEmptyError,
  FolderTooBigError,
  MAX_FOLDER_TOTAL_BYTES,
} from './collectDroppedEntries';

interface FakeTree {
  [name: string]: FakeTree | string;
}

function fakeFileEntry(
  name: string,
  fullPath: string,
  contents: string
): FileSystemFileEntry {
  return {
    isFile: true,
    isDirectory: false,
    name,
    fullPath,
    file: (resolve: (file: File) => void) => {
      resolve(new File([contents], name));
    },
  } as unknown as FileSystemFileEntry;
}

function fakeDirEntry(
  name: string,
  fullPath: string,
  children: FileSystemEntry[],
  batchSize = 2
): FileSystemDirectoryEntry {
  return {
    isFile: false,
    isDirectory: true,
    name,
    fullPath,
    createReader: () => {
      let cursor = 0;
      return {
        readEntries: (resolve: (batch: FileSystemEntry[]) => void) => {
          const batch = children.slice(cursor, cursor + batchSize);
          cursor += batch.length;
          resolve(batch);
        },
      };
    },
  } as unknown as FileSystemDirectoryEntry;
}

function buildTree(tree: FakeTree, base = ''): FileSystemEntry[] {
  return Object.entries(tree).map(([name, value]) => {
    const fullPath = `${base}/${name}`;
    if (typeof value === 'string') {
      return fakeFileEntry(name, fullPath, value);
    }
    return fakeDirEntry(name, fullPath, buildTree(value, fullPath));
  });
}

describe('hasDirectoryEntry', () => {
  it('is true when any entry is a directory', () => {
    const entries = buildTree({ 'Page.html': '<html></html>', Export: {} });
    expect(hasDirectoryEntry(entries)).toBe(true);
  });

  it('is false for a plain file drop and null entries', () => {
    expect(
      hasDirectoryEntry([...buildTree({ 'Page.html': '<html></html>' }), null])
    ).toBe(false);
  });
});

describe('collectDroppedEntries', () => {
  it('flattens a nested folder preserving relative paths', async () => {
    const entries = buildTree({
      Export: {
        'Page.html': '<html>page</html>',
        images: {
          'a.png': 'png-bytes',
          'b.png': 'more-bytes',
        },
      },
    });

    const files = await collectDroppedEntries(entries);

    expect(files.map((f) => f.path).sort()).toEqual([
      'Export/Page.html',
      'Export/images/a.png',
      'Export/images/b.png',
    ]);
    expect(await files[0].file.text()).toBe('<html>page</html>');
  });

  it('drains batched readEntries calls completely', async () => {
    const children = Array.from({ length: 7 }, (_, i) =>
      fakeFileEntry(`f${i}.html`, `/Big/f${i}.html`, `<p>${i}</p>`)
    );
    const entries = [fakeDirEntry('Big', '/Big', children, 2)];

    const files = await collectDroppedEntries(entries);

    expect(files).toHaveLength(7);
  });

  it('skips hidden files and __MACOSX directories', async () => {
    const entries = buildTree({
      Export: {
        '.DS_Store': 'junk',
        __MACOSX: { 'ghost.html': 'resource fork' },
        'Page.html': '<html></html>',
      },
    });

    const files = await collectDroppedEntries(entries);

    expect(files.map((f) => f.path)).toEqual(['Export/Page.html']);
  });

  it('throws FolderEmptyError when only skipped files remain', async () => {
    const entries = buildTree({
      Export: { '.DS_Store': 'junk' },
    });

    await expect(collectDroppedEntries(entries)).rejects.toBeInstanceOf(
      FolderEmptyError
    );
  });

  it('throws FolderTooBigError past the total-size cap', async () => {
    const bigContents = 'x'.repeat(1024);
    const bigFile = fakeFileEntry('big.html', '/big.html', bigContents);
    Object.defineProperty(bigFile, 'file', {
      value: (resolve: (file: File) => void) => {
        const file = new File([bigContents], 'big.html');
        Object.defineProperty(file, 'size', {
          value: MAX_FOLDER_TOTAL_BYTES + 1,
        });
        resolve(file);
      },
    });

    await expect(collectDroppedEntries([bigFile])).rejects.toBeInstanceOf(
      FolderTooBigError
    );
  });
});
