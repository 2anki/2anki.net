import JSZip from 'jszip';
import Database from 'better-sqlite3';

import { extractApkg, InvalidApkgError } from './extractApkg';
import { parseCollection } from './parseCollection';

function buildLegacyCollectionBuffer(): Buffer {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE col (
      id INTEGER PRIMARY KEY,
      crt INTEGER DEFAULT 0,
      mod INTEGER DEFAULT 0,
      scm INTEGER DEFAULT 0,
      ver INTEGER DEFAULT 0,
      dty INTEGER DEFAULT 0,
      usn INTEGER DEFAULT 0,
      ls INTEGER DEFAULT 0,
      conf TEXT DEFAULT '{}',
      models TEXT,
      decks TEXT,
      dconf TEXT DEFAULT '{}',
      tags TEXT DEFAULT '{}'
    );
    CREATE TABLE notes (
      id INTEGER PRIMARY KEY,
      guid TEXT, mid INTEGER, mod INTEGER, usn INTEGER,
      tags TEXT, flds TEXT, sfld TEXT, csum INTEGER, flags INTEGER, data TEXT
    );
    CREATE TABLE cards (
      id INTEGER PRIMARY KEY,
      nid INTEGER, did INTEGER, ord INTEGER, mod INTEGER, usn INTEGER,
      type INTEGER, queue INTEGER, due INTEGER, ivl INTEGER, factor INTEGER,
      reps INTEGER, lapses INTEGER, left INTEGER, odue INTEGER, odid INTEGER,
      flags INTEGER, data TEXT
    );
  `);
  const models = {
    '1': {
      id: 1,
      name: 'Basic',
      type: 0,
      css: '.card{}',
      flds: [
        { name: 'Front', ord: 0 },
        { name: 'Back', ord: 1 },
      ],
      tmpls: [{ name: 'Card 1', ord: 0, qfmt: '{{Front}}', afmt: '{{Back}}' }],
    },
  };
  const decks = { '2': { id: 2, name: 'Demo' } };
  db.prepare('INSERT INTO col (id, models, decks) VALUES (1, ?, ?)').run(
    JSON.stringify(models),
    JSON.stringify(decks)
  );
  db.prepare(
    "INSERT INTO notes (id, guid, mid, tags, flds, sfld) VALUES (10, 'g', 1, ' ', 'hello\x1fworld', 'hello')"
  ).run();
  db.prepare(
    'INSERT INTO cards (id, nid, did, ord) VALUES (100, 10, 2, 0)'
  ).run();
  const buf = Buffer.from(db.serialize());
  db.close();
  return buf;
}

async function buildApkgZip(
  collectionName: string,
  collectionBuffer: Buffer
): Promise<Buffer> {
  const zip = new JSZip();
  zip.file(collectionName, collectionBuffer);
  zip.file('media', '{}');
  return zip.generateAsync({ type: 'nodebuffer' });
}

describe('extractApkg + parseCollection composition', () => {
  it('parses notes from a real .apkg zip wrapping a legacy collection.anki2', async () => {
    const apkg = await buildApkgZip(
      'collection.anki2',
      buildLegacyCollectionBuffer()
    );

    const archive = await extractApkg(apkg);
    const collection = parseCollection(archive.collectionBuffer);

    expect(archive.collectionName).toBe('collection.anki2');
    expect(collection.notes.size).toBe(1);
    expect(collection.notes.get(10)?.fields).toEqual(['hello', 'world']);
  });

  it('feeding the raw .apkg zip to parseCollection directly throws SQLITE_NOTADB (regression guard)', async () => {
    const apkg = await buildApkgZip(
      'collection.anki2',
      buildLegacyCollectionBuffer()
    );
    expect(() => parseCollection(apkg)).toThrow(/not a database/i);
  });

  it('decompresses zstd-compressed collection.anki21b archives', async () => {
    const zlib = await import('zlib');
    const { promisify } = await import('util');
    const zstdCompress = promisify(zlib.zstdCompress);
    const sqliteBuffer = buildLegacyCollectionBuffer();
    const compressed = await zstdCompress(sqliteBuffer);
    const apkg = await buildApkgZip('collection.anki21b', compressed);

    const archive = await extractApkg(apkg);
    const collection = parseCollection(archive.collectionBuffer);

    expect(archive.collectionName).toBe('collection.anki21b');
    expect(collection.notes.size).toBe(1);
    expect(collection.notes.get(10)?.fields).toEqual(['hello', 'world']);
  });
});

describe('extractApkg on files that are not Anki packages', () => {
  it('rejects a file that is not a zip with InvalidApkgError', async () => {
    await expect(
      extractApkg(Buffer.from('%PDF-1.4 definitely not a zip'))
    ).rejects.toBeInstanceOf(InvalidApkgError);
  });

  it('keeps the zip reader message on the error for the server log', async () => {
    await expect(
      extractApkg(Buffer.from('%PDF-1.4 definitely not a zip'))
    ).rejects.toThrow(/end of central directory/i);
  });

  it('rejects a zip with no collection file with InvalidApkgError', async () => {
    const zip = new JSZip();
    zip.file('media', '{}');
    zip.file('notes.txt', 'front;back');
    const notAnApkg = await zip.generateAsync({ type: 'nodebuffer' });

    await expect(extractApkg(notAnApkg)).rejects.toBeInstanceOf(
      InvalidApkgError
    );
  });
});

describe('extractApkg decompression caps', () => {
  const { ApkgTooLargeError } = require('./extractApkg');

  it('rejects on declared sizes before inflating when the total cap is exceeded', async () => {
    const zip = new JSZip();
    zip.file('collection.anki2', Buffer.alloc(64 * 1024, 0));
    zip.file('media', '{}');
    const apkg = await zip.generateAsync({ type: 'nodebuffer' });

    await expect(
      extractApkg(apkg, { maxTotalDecompressedBytes: 16 * 1024 })
    ).rejects.toBeInstanceOf(ApkgTooLargeError);
  });

  it('rejects when the archive holds more entries than the cap', async () => {
    const zip = new JSZip();
    zip.file('collection.anki2', buildLegacyCollectionBuffer());
    zip.file('media', '{}');
    for (let i = 0; i < 5; i++) {
      zip.file(String(i), Buffer.from('x'));
    }
    const apkg = await zip.generateAsync({ type: 'nodebuffer' });

    await expect(extractApkg(apkg, { maxEntries: 4 })).rejects.toBeInstanceOf(
      ApkgTooLargeError
    );
  });

  it('rejects when the zstd collection expands past the collection cap', async () => {
    const zlib = await import('zlib');
    const { promisify } = await import('util');
    const zstdCompress = promisify(zlib.zstdCompress);
    const compressed = await zstdCompress(Buffer.alloc(4 * 1024 * 1024, 0));
    const apkg = await buildApkgZip('collection.anki21b', compressed as Buffer);

    await expect(
      extractApkg(apkg, {
        maxTotalDecompressedBytes: 64 * 1024 * 1024,
        maxCollectionDecompressedBytes: 1024 * 1024,
      })
    ).rejects.toBeInstanceOf(ApkgTooLargeError);
  });

  it('carries a user-safe message with no archive internals', async () => {
    const zip = new JSZip();
    zip.file('collection.anki2', Buffer.alloc(64 * 1024, 0));
    const apkg = await zip.generateAsync({ type: 'nodebuffer' });

    const err = await extractApkg(apkg, {
      maxTotalDecompressedBytes: 1024,
    }).catch((e) => e);
    expect(err.name).toBe('ApkgTooLargeError');
    expect(err.message).toBe('This Anki package is too large to process.');
  });
});
