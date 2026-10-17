import { strToU8, zipSync } from 'fflate';

import {
  readEmptyUpload,
  READING_MAX_BYTES,
  READING_MAX_FILES,
} from './readEmptyUpload';

function bytesFrom(contents: Record<string, string | Buffer>) {
  return async (file: { originalname: string }) => {
    const value = contents[file.originalname];
    if (value == null) return null;
    return typeof value === 'string' ? Buffer.from(value, 'utf8') : value;
  };
}

describe('readEmptyUpload', () => {
  it('sums the visible structure of text documents', async () => {
    const reading = await readEmptyUpload(
      [
        { originalname: 'notes.html', size: 10 },
        { originalname: 'more.md', size: 10 },
      ],
      bytesFrom({
        'notes.html':
          '<h1>Cell biology</h1><p>The nucleus holds DNA.</p><ul><li>one</li><li>two</li></ul><table><tr><td>x</td></tr></table><img src="a.png">',
        'more.md': 'Just three words',
      })
    );
    expect(reading).toEqual({
      kind: 'document',
      words: 12,
      headings: 1,
      listItems: 2,
      tables: 1,
      toggles: 0,
      images: 1,
    });
  });

  it('reads a zip as its entry census', async () => {
    const zip = Buffer.from(
      zipSync({
        'Page abc.html': strToU8('<html></html>'),
        'a.png': strToU8('png'),
        'b.jpg': strToU8('jpg'),
        'deck.colpkg': strToU8('x'),
      })
    );
    const reading = await readEmptyUpload(
      [{ originalname: 'export.zip', size: zip.length }],
      bytesFrom({ 'export.zip': zip })
    );
    expect(reading).toEqual({
      kind: 'zip',
      files: 4,
      readable: 1,
      archives: 0,
      imageFiles: 2,
      otherFiles: 1,
    });
  });

  it('counts a wrapper zip whose only entry is another zip', async () => {
    const inner = zipSync({ 'Page abc.html': strToU8('<html></html>') });
    const zip = Buffer.from(zipSync({ 'Export-Part-1.zip': inner }));
    const reading = await readEmptyUpload(
      [{ originalname: 'export.zip', size: zip.length }],
      bytesFrom({ 'export.zip': zip })
    );
    expect(reading).toEqual({
      kind: 'zip',
      files: 1,
      readable: 0,
      archives: 1,
      imageFiles: 0,
      otherFiles: 0,
    });
  });

  it('returns null for formats the census cannot read', async () => {
    const reading = await readEmptyUpload(
      [{ originalname: 'slides.exe', size: 10 }],
      bytesFrom({ 'slides.exe': 'MZ' })
    );
    expect(reading).toBeNull();
  });

  it('returns null when the bytes are gone', async () => {
    const reading = await readEmptyUpload(
      [{ originalname: 'notes.html', size: 10 }],
      async () => null
    );
    expect(reading).toBeNull();
  });

  it('spends one byte budget across the files it reads', async () => {
    const seen: string[] = [];
    const readBytes = async (file: { originalname: string }) => {
      seen.push(file.originalname);
      return Buffer.from('<p>word</p>');
    };
    const files = [
      { originalname: 'a.html', size: 3 * 1024 * 1024 },
      { originalname: 'b.html', size: 3 * 1024 * 1024 },
      { originalname: 'c.html', size: 1024 },
    ];
    const reading = await readEmptyUpload(files, readBytes);
    expect(seen).toEqual(['a.html', 'c.html']);
    expect(reading).toMatchObject({ kind: 'document', words: 2 });
  });

  it('skips oversized files and stops after the file cap', async () => {
    const readBytes = vi.fn(async () => Buffer.from('<p>word</p>'));
    const files = Array.from({ length: READING_MAX_FILES + 2 }, (_, i) => ({
      originalname: `f${i}.html`,
      size: i === 0 ? READING_MAX_BYTES + 1 : 10,
    }));
    const reading = await readEmptyUpload(files, readBytes);
    expect(readBytes).toHaveBeenCalledTimes(READING_MAX_FILES);
    expect(reading).toMatchObject({ kind: 'document', words: 5 });
  });
});
