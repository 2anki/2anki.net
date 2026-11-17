import zlib from 'node:zlib';
import JSZip from 'jszip';
import Database from 'better-sqlite3';
import PackEditedApkgUseCase from './PackEditedApkgUseCase';
import {
  extractApkg,
  parseMediaManifest,
} from '../../services/ApkgPreviewService/extractApkg';
import { parseCollection } from '../../services/ApkgPreviewService/parseCollection';

function buildCollectionBuffer(
  cards: Array<{ front: string; back: string }>
): Buffer {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE col (
      id INTEGER PRIMARY KEY, crt INTEGER DEFAULT 0, mod INTEGER DEFAULT 0,
      scm INTEGER DEFAULT 0, ver INTEGER DEFAULT 0, dty INTEGER DEFAULT 0,
      usn INTEGER DEFAULT 0, ls INTEGER DEFAULT 0, conf TEXT DEFAULT '{}',
      models TEXT, decks TEXT, dconf TEXT DEFAULT '{}', tags TEXT DEFAULT '{}'
    );
    CREATE TABLE notes (
      id INTEGER PRIMARY KEY, guid TEXT, mid INTEGER, mod INTEGER DEFAULT 0,
      usn INTEGER DEFAULT 0, tags TEXT, flds TEXT, sfld TEXT, csum INTEGER DEFAULT 0,
      flags INTEGER DEFAULT 0, data TEXT DEFAULT ''
    );
    CREATE TABLE cards (
      id INTEGER PRIMARY KEY, nid INTEGER, did INTEGER, ord INTEGER, mod INTEGER DEFAULT 0,
      usn INTEGER DEFAULT 0, type INTEGER DEFAULT 0, queue INTEGER DEFAULT 0,
      due INTEGER DEFAULT 0, ivl INTEGER DEFAULT 0, factor INTEGER DEFAULT 0,
      reps INTEGER DEFAULT 0, lapses INTEGER DEFAULT 0, left INTEGER DEFAULT 0,
      odue INTEGER DEFAULT 0, odid INTEGER DEFAULT 0, flags INTEGER DEFAULT 0,
      data TEXT DEFAULT ''
    );
  `);
  const models = {
    '1': {
      id: 1,
      name: 'Basic',
      type: 0,
      css: '',
      flds: [
        { name: 'Front', ord: 0 },
        { name: 'Back', ord: 1 },
      ],
      tmpls: [{ name: 'Card 1', ord: 0, qfmt: '{{Front}}', afmt: '{{Back}}' }],
    },
  };
  const decks = { '2': { id: 2, name: 'Test' } };
  db.prepare('INSERT INTO col (id, models, decks) VALUES (1, ?, ?)').run(
    JSON.stringify(models),
    JSON.stringify(decks)
  );
  for (let i = 0; i < cards.length; i++) {
    const noteId = i + 10;
    const cardId = i + 100;
    db.prepare(
      "INSERT INTO notes (id, guid, mid, tags, flds, sfld) VALUES (?, ?, 1, ' ', ?, ?)"
    ).run(
      noteId,
      `guid${i}`,
      `${cards[i].front}\x1f${cards[i].back}`,
      cards[i].front
    );
    db.prepare('INSERT INTO cards (id, nid, did, ord) VALUES (?, ?, 2, 0)').run(
      cardId,
      noteId
    );
  }
  const buf = Buffer.from(db.serialize());
  db.close();
  return buf;
}

async function buildApkgBuffer(
  cards: Array<{ front: string; back: string }>
): Promise<Buffer> {
  const col = buildCollectionBuffer(cards);
  const zip = new JSZip();
  zip.file('collection.anki2', col);
  zip.file('media', '{}');
  return zip.generateAsync({ type: 'nodebuffer' });
}

const useCase = new PackEditedApkgUseCase();

describe('PackEditedApkgUseCase', () => {
  it('returns an .apkg with all cards when edits is empty', async () => {
    const apkg = await buildApkgBuffer([
      { front: 'Q1', back: 'A1' },
      { front: 'Q2', back: 'A2' },
    ]);
    const result = await useCase.execute({
      sourceBytes: apkg,
      filename: 'deck.apkg',
      edits: [],
    });
    const archive = await extractApkg(result.buffer);
    const col = parseCollection(archive.collectionBuffer);
    expect(col.cards).toHaveLength(2);
  });

  it('omits deleted cards from the output .apkg', async () => {
    const apkg = await buildApkgBuffer([
      { front: 'Q1', back: 'A1' },
      { front: 'Q2', back: 'A2' },
      { front: 'Q3', back: 'A3' },
    ]);
    const result = await useCase.execute({
      sourceBytes: apkg,
      filename: 'deck.apkg',
      edits: [{ cardIndex: 1, deleted: true }],
    });
    const archive = await extractApkg(result.buffer);
    const col = parseCollection(archive.collectionBuffer);
    expect(col.cards).toHaveLength(2);
  });

  it('applies front text edit to the matching note', async () => {
    const apkg = await buildApkgBuffer([{ front: 'original', back: 'A1' }]);
    const result = await useCase.execute({
      sourceBytes: apkg,
      filename: 'deck.apkg',
      edits: [{ cardIndex: 0, front: 'edited front' }],
    });
    const archive = await extractApkg(result.buffer);
    const col = parseCollection(archive.collectionBuffer);
    const note = col.notes.get(10);
    expect(note?.fields[0]).toBe('edited front');
  });

  it('applies back text edit to the matching note', async () => {
    const apkg = await buildApkgBuffer([{ front: 'Q', back: 'original back' }]);
    const result = await useCase.execute({
      sourceBytes: apkg,
      filename: 'deck.apkg',
      edits: [{ cardIndex: 0, back: 'edited back' }],
    });
    const archive = await extractApkg(result.buffer);
    const col = parseCollection(archive.collectionBuffer);
    const note = col.notes.get(10);
    expect(note?.fields[1]).toBe('edited back');
  });

  it('sets queue=-1 on suspended cards', async () => {
    const apkg = await buildApkgBuffer([
      { front: 'Q1', back: 'A1' },
      { front: 'Q2', back: 'A2' },
    ]);
    const result = await useCase.execute({
      sourceBytes: apkg,
      filename: 'deck.apkg',
      edits: [{ cardIndex: 0, suspended: true }],
    });
    const archive = await extractApkg(result.buffer);
    const col = parseCollection(archive.collectionBuffer);
    const cardId = col.cards[0].id;
    const tmpDb = new Database(archive.collectionBuffer);
    const row = tmpDb
      .prepare('SELECT queue FROM cards WHERE id = ?')
      .get(cardId) as { queue: number } | undefined;
    tmpDb.close();
    expect(row?.queue).toBe(-1);
  });

  it('returns a filename with -edited suffix', async () => {
    const apkg = await buildApkgBuffer([{ front: 'Q', back: 'A' }]);
    const result = await useCase.execute({
      sourceBytes: apkg,
      filename: 'my-deck.apkg',
      edits: [],
    });
    expect(result.filename).toBe('my-deck-edited.apkg');
  });
});

const ZSTD_MAGIC = Buffer.from([0x28, 0xb5, 0x2f, 0xfd]);
const SQLITE_HEADER = Buffer.from('SQLite format 3\0', 'latin1');
const LATEST_PACKAGE_META = Buffer.from([0x08, 0x03]);
const LEGACY_2_PACKAGE_META = Buffer.from([0x08, 0x02]);
const MEDIA_FILE_BYTES = Buffer.from('synthetic image bytes');
const PLACEHOLDER_CARD = {
  front: 'Please update to the latest Anki version',
  back: '',
};

function encodeMediaEntries(names: string[]): Buffer {
  const entries = names.map((name) => {
    const nameBytes = Buffer.from(name, 'utf8');
    const entry = Buffer.concat([
      Buffer.from([0x0a, nameBytes.length]),
      nameBytes,
    ]);
    return Buffer.concat([Buffer.from([0x0a, entry.length]), entry]);
  });
  return Buffer.concat(entries);
}

async function buildNewFormatApkg(
  cards: Array<{ front: string; back: string }>
) {
  const meta = LATEST_PACKAGE_META;
  const placeholder = buildCollectionBuffer([PLACEHOLDER_CARD]);
  const mediaList = zlib.zstdCompressSync(encodeMediaEntries(['picture.png']));
  const mediaFile = zlib.zstdCompressSync(MEDIA_FILE_BYTES);
  const zip = new JSZip();
  zip.file('meta', meta);
  zip.file(
    'collection.anki21b',
    zlib.zstdCompressSync(buildCollectionBuffer(cards))
  );
  zip.file('collection.anki2', placeholder);
  zip.file('0', mediaFile);
  zip.file('media', mediaList);
  const apkg = await zip.generateAsync({ type: 'nodebuffer' });
  return { apkg, meta, placeholder, mediaList, mediaFile };
}

async function readEntries(apkg: Buffer): Promise<Map<string, Buffer>> {
  const zip = await JSZip.loadAsync(apkg);
  const entries = new Map<string, Buffer>();
  for (const name of Object.keys(zip.files)) {
    entries.set(name, await zip.files[name].async('nodebuffer'));
  }
  return entries;
}

function readFirstNoteFields(sqlite: Buffer): string[] {
  const db = new Database(sqlite);
  try {
    const row = db.prepare('SELECT flds FROM notes ORDER BY id').get() as {
      flds: string;
    };
    return row.flds.split('\x1f');
  } finally {
    db.close();
  }
}

describe('PackEditedApkgUseCase with a new-format deck', () => {
  async function packEditedNewFormat() {
    const input = await buildNewFormatApkg([
      { front: 'original', back: 'A1' },
      { front: 'Q2', back: 'A2' },
    ]);
    const result = await useCase.execute({
      sourceBytes: input.apkg,
      filename: 'deck.apkg',
      edits: [{ cardIndex: 0, front: 'edited front' }],
    });
    return { input, output: await readEntries(result.buffer), result };
  }

  it('writes collection.anki21b as a zstd frame of the edited SQLite collection', async () => {
    const { output } = await packEditedNewFormat();
    const collection = output.get('collection.anki21b') as Buffer;

    expect(collection.subarray(0, 4)).toEqual(ZSTD_MAGIC);
    const sqlite = zlib.zstdDecompressSync(collection);
    expect(sqlite.subarray(0, SQLITE_HEADER.length)).toEqual(SQLITE_HEADER);
    expect(readFirstNoteFields(sqlite)).toEqual(['edited front', 'A1']);
  });

  it('keeps the meta file byte for byte', async () => {
    const { input, output } = await packEditedNewFormat();

    expect(output.get('meta')).toEqual(input.meta);
  });

  it('keeps the collection.anki2 placeholder byte for byte', async () => {
    const { input, output } = await packEditedNewFormat();

    expect(output.get('collection.anki2')).toEqual(input.placeholder);
  });

  it('keeps the zstd media list and zstd media files byte for byte', async () => {
    const { input, output } = await packEditedNewFormat();

    expect(output.get('media')).toEqual(input.mediaList);
    expect(output.get('0')).toEqual(input.mediaFile);
    expect(zlib.zstdDecompressSync(output.get('0') as Buffer)).toEqual(
      MEDIA_FILE_BYTES
    );
  });

  it('reports the collection format it packed', async () => {
    const { result } = await packEditedNewFormat();

    expect(result.collectionName).toBe('collection.anki21b');
  });

  it('writes exactly the entries the input had', async () => {
    const { output } = await packEditedNewFormat();

    expect([...output.keys()].sort()).toEqual(
      ['0', 'collection.anki2', 'collection.anki21b', 'media', 'meta'].sort()
    );
  });

  it('reads back through extractApkg as the edited deck with its media', async () => {
    const { result } = await packEditedNewFormat();
    const archive = await extractApkg(result.buffer);

    expect(archive.collectionName).toBe('collection.anki21b');
    expect(
      parseCollection(archive.collectionBuffer).notes.get(10)?.fields
    ).toEqual(['edited front', 'A1']);
    expect(parseMediaManifest(archive.mediaManifestRaw)).toEqual(
      new Map([['picture.png', '0']])
    );
  });

  it('writes an empty zstd media list when the input had none', async () => {
    const zip = new JSZip();
    zip.file('meta', LATEST_PACKAGE_META);
    zip.file(
      'collection.anki21b',
      zlib.zstdCompressSync(buildCollectionBuffer([{ front: 'Q', back: 'A' }]))
    );
    const apkg = await zip.generateAsync({ type: 'nodebuffer' });

    const result = await useCase.execute({
      sourceBytes: apkg,
      filename: 'deck.apkg',
      edits: [],
    });
    const media = (await readEntries(result.buffer)).get('media') as Buffer;

    expect(media.subarray(0, 4)).toEqual(ZSTD_MAGIC);
    expect(zlib.zstdDecompressSync(media)).toEqual(Buffer.alloc(0));
  });
});

describe('PackEditedApkgUseCase with a legacy-format deck', () => {
  it.each([
    {
      layout: 'collection.anki2 only, as 2anki generates',
      collectionName: 'collection.anki2',
      extraEntries: new Map<string, Buffer>(),
      expectedNames: ['collection.anki2', 'media'],
    },
    {
      layout: 'collection.anki21 with meta and a placeholder',
      collectionName: 'collection.anki21',
      extraEntries: new Map<string, Buffer>([
        ['meta', LEGACY_2_PACKAGE_META],
        ['collection.anki2', buildCollectionBuffer([PLACEHOLDER_CARD])],
      ]),
      expectedNames: ['collection.anki21', 'media'],
    },
  ])(
    'writes plain SQLite under the same name for $layout',
    async ({ collectionName, extraEntries, expectedNames }) => {
      const zip = new JSZip();
      for (const [name, content] of extraEntries) {
        zip.file(name, content);
      }
      zip.file(
        collectionName,
        buildCollectionBuffer([{ front: 'original', back: 'A1' }])
      );
      zip.file('media', '{}');
      const apkg = await zip.generateAsync({ type: 'nodebuffer' });

      const result = await useCase.execute({
        sourceBytes: apkg,
        filename: 'deck.apkg',
        edits: [{ cardIndex: 0, front: 'edited front' }],
      });
      const output = await readEntries(result.buffer);
      const collection = output.get(collectionName) as Buffer;

      expect([...output.keys()].sort()).toEqual([...expectedNames].sort());
      expect(collection.subarray(0, SQLITE_HEADER.length)).toEqual(
        SQLITE_HEADER
      );
      expect(readFirstNoteFields(collection)).toEqual(['edited front', 'A1']);
      expect(output.get('media')?.toString('utf8')).toBe('{}');
    }
  );
});
