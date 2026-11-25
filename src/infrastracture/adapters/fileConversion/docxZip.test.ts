import { strToU8, unzipSync, zipSync } from 'fflate';

import {
  inflateEntry,
  readZipDirectory,
  replaceZipEntry,
  UnsupportedZip,
} from './docxZip';

function sampleZip(): Buffer {
  return Buffer.from(
    zipSync({
      'word/document.xml': strToU8('<w:document>old</w:document>'),
      'word/media/a.png': [new Uint8Array([1, 2, 3, 4]), { level: 0 }],
      'word/styles.xml': strToU8('<w:styles/>'.repeat(50)),
    })
  );
}

describe('docxZip', () => {
  it('reads each entry with its declared size before inflating anything', () => {
    const directory = readZipDirectory(sampleZip());

    expect([...directory.entries.keys()]).toEqual([
      'word/document.xml',
      'word/media/a.png',
      'word/styles.xml',
    ]);
    expect(directory.entries.get('word/styles.xml')?.size).toBe(550);
  });

  it('inflates an entry to its declared bytes', () => {
    const zip = sampleZip();
    const entry = readZipDirectory(zip).entries.get('word/styles.xml');
    if (entry == null) throw new Error('missing entry');

    expect(inflateEntry(zip, entry).toString()).toBe('<w:styles/>'.repeat(50));
  });

  it('replaces one entry and keeps every other entry readable and unchanged', () => {
    const zip = sampleZip();
    const directory = readZipDirectory(zip);

    const replaced = replaceZipEntry(
      zip,
      directory,
      'word/document.xml',
      Buffer.from('<w:document>new</w:document>')
    );
    const files = unzipSync(new Uint8Array(replaced));

    expect(Buffer.from(files['word/document.xml']).toString()).toBe(
      '<w:document>new</w:document>'
    );
    expect([...files['word/media/a.png']]).toEqual([1, 2, 3, 4]);
    expect(Buffer.from(files['word/styles.xml']).toString()).toBe(
      '<w:styles/>'.repeat(50)
    );
  });

  it('declines an entry whose inflated size differs from the one declared', () => {
    const zip = Buffer.from(sampleZip());
    const entry = readZipDirectory(zip).entries.get('word/styles.xml');
    if (entry == null) throw new Error('missing entry');

    expect(() => inflateEntry(zip, { ...entry, size: 10 })).toThrow(
      UnsupportedZip
    );
  });

  it.each([
    ['bytes that are not a zip', Buffer.from('not a zip at all, just text')],
    ['a zip cut short', sampleZip().subarray(0, 60)],
  ])('declines %s', (_kind, bytes) => {
    expect(() => readZipDirectory(bytes)).toThrow(UnsupportedZip);
  });
});
