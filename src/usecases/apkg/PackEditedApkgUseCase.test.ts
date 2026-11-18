import { readFileSync } from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import JSZip from 'jszip';
import Database from 'better-sqlite3';
import PackEditedApkgUseCase, { CardEdit } from './PackEditedApkgUseCase';
import {
  extractApkg,
  parseMediaManifest,
} from '../../services/ApkgPreviewService/extractApkg';
import { parseCollection } from '../../services/ApkgPreviewService/parseCollection';
import { buildModernCollection } from '../../test/fixtures/apkg/buildModernCollection';

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
      edits: [{ cardId: 101, deleted: true }],
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
      edits: [{ cardId: 100, fields: [{ index: 0, value: 'edited front' }] }],
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
      edits: [{ cardId: 100, fields: [{ index: 1, value: 'edited back' }] }],
    });
    const archive = await extractApkg(result.buffer);
    const col = parseCollection(archive.collectionBuffer);
    const note = col.notes.get(10);
    expect(note?.fields[1]).toBe('edited back');
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
      edits: [{ cardId: 100, fields: [{ index: 0, value: 'edited front' }] }],
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
        edits: [{ cardId: 100, fields: [{ index: 0, value: 'edited front' }] }],
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

const SEP = String.fromCharCode(0x1f);

interface ModelFixture {
  id: number;
  name: string;
  type: 0 | 1;
  fields: string[];
  templates: Array<{ qfmt: string; afmt: string }>;
}

function n2aModel(id: number, name: string): ModelFixture {
  const file = path.join(__dirname, '../../templates', `${name}.json`);
  const template = JSON.parse(readFileSync(file, 'utf8')) as {
    fields: Array<{ name: string }>;
    front: string;
    back: string;
  };
  return {
    id,
    name,
    type: 0,
    fields: template.fields.map((field) => field.name),
    templates: [{ qfmt: template.front, afmt: template.back }],
  };
}

const MODELS: ModelFixture[] = [
  {
    id: 1,
    name: 'Basic',
    type: 0,
    fields: ['Front', 'Back'],
    templates: [
      { qfmt: '{{Front}}', afmt: '{{FrontSide}}<hr id=answer>{{Back}}' },
    ],
  },
  {
    id: 2,
    name: 'Basic (and reversed card)',
    type: 0,
    fields: ['Front', 'Back'],
    templates: [
      { qfmt: '{{Front}}', afmt: '{{FrontSide}}<hr id=answer>{{Back}}' },
      { qfmt: '{{Back}}', afmt: '{{FrontSide}}<hr id=answer>{{Front}}' },
    ],
  },
  {
    id: 3,
    name: 'Cloze',
    type: 1,
    fields: ['Text', 'Back Extra'],
    templates: [
      { qfmt: '{{cloze:Text}}', afmt: '{{cloze:Text}}<br>{{Back Extra}}' },
    ],
  },
  {
    id: 4,
    name: 'Vocab',
    type: 0,
    fields: ['Word', 'Pronunciation', 'Meaning'],
    templates: [
      {
        qfmt: '{{Word}}<br>{{Pronunciation}}',
        afmt: '{{FrontSide}}<hr id=answer>{{Meaning}}',
      },
    ],
  },
  n2aModel(5, 'n2a-basic'),
  n2aModel(6, 'n2a-mcq'),
];

const HTML_FRONT =
  'Line one<br>Line&nbsp;two <img src="diagram.png"> [sound:say.mp3]';
const HTML_BACK = '<div>Answer<br/></div>&nbsp;<img src="a b.png">';

const NOTES: Array<{ id: number; mid: number; fields: string[] }> = [
  { id: 10, mid: 1, fields: ['Q1', 'A1'] },
  { id: 11, mid: 1, fields: [HTML_FRONT, HTML_BACK] },
  { id: 20, mid: 2, fields: ['Capital of Norway', 'Oslo'] },
  { id: 30, mid: 3, fields: ['{{c1::Oslo}} is in {{c2::Norway}}', 'extra'] },
  { id: 40, mid: 4, fields: ['word', 'pron', 'meaning'] },
  { id: 50, mid: 5, fields: ['front', 'back', 'media'] },
  {
    id: 60,
    mid: 6,
    fields: ['Capital of Norway?', 'Oslo<br>Bergen', 'Oslo', 'explanation'],
  },
];

const CARDS: Array<{ id: number; nid: number; did: number; ord: number }> = [
  { id: 90, nid: 99, did: 2, ord: 0 },
  { id: 100, nid: 10, did: 2, ord: 0 },
  { id: 101, nid: 11, did: 3, ord: 0 },
  { id: 200, nid: 20, did: 2, ord: 0 },
  { id: 201, nid: 20, did: 2, ord: 1 },
  { id: 300, nid: 30, did: 2, ord: 0 },
  { id: 301, nid: 30, did: 2, ord: 1 },
  { id: 400, nid: 40, did: 2, ord: 0 },
  { id: 500, nid: 50, did: 3, ord: 0 },
  { id: 600, nid: 60, did: 2, ord: 0 },
];

function buildMixedCollection(): Buffer {
  const db = new Database(buildCollectionBuffer([]));
  const models = Object.fromEntries(
    MODELS.map((model) => [
      String(model.id),
      {
        id: model.id,
        name: model.name,
        type: model.type,
        css: '',
        flds: model.fields.map((name, ord) => ({ name, ord })),
        tmpls: model.templates.map((t, ord) => ({
          name: `Card ${ord + 1}`,
          ord,
          ...t,
        })),
      },
    ])
  );
  const decks = { '2': { id: 2, name: 'A' }, '3': { id: 3, name: 'B' } };
  db.prepare('UPDATE col SET models = ?, decks = ?').run(
    JSON.stringify(models),
    JSON.stringify(decks)
  );
  for (const note of NOTES) {
    db.prepare(
      "INSERT INTO notes (id, guid, mid, mod, usn, tags, flds, sfld, csum) VALUES (?, ?, ?, 1700000000, 3, ' ', ?, ?, 99)"
    ).run(
      note.id,
      `guid${note.id}`,
      note.mid,
      note.fields.join(SEP),
      note.fields[0]
    );
  }
  for (const card of CARDS) {
    db.prepare(
      'INSERT INTO cards (id, nid, did, ord, mod, usn) VALUES (?, ?, ?, ?, 1700000000, 3)'
    ).run(card.id, card.nid, card.did, card.ord);
  }
  const buf = Buffer.from(db.serialize());
  db.close();
  return buf;
}

type Row = Record<string, unknown>;

function readRows(sqlite: Buffer): { notes: Row[]; cards: Row[] } {
  const db = new Database(sqlite);
  try {
    return {
      notes: db.prepare('SELECT * FROM notes ORDER BY id').all() as Row[],
      cards: db.prepare('SELECT * FROM cards ORDER BY id').all() as Row[],
    };
  } finally {
    db.close();
  }
}

function fieldsOf(rows: { notes: Row[] }, noteId: number): string[] {
  const note = rows.notes.find((row) => row.id === noteId);
  return String(note?.flds).split(SEP);
}

function otherNotes(rows: { notes: Row[] }, noteId: number): Row[] {
  return rows.notes.filter((row) => row.id !== noteId);
}

describe('PackEditedApkgUseCase applies edits by card id to stored fields', () => {
  async function packWith(edits: CardEdit[]) {
    const input = buildMixedCollection();
    const zip = new JSZip();
    zip.file('collection.anki2', input);
    zip.file('media', '{}');
    const result = await useCase.execute({
      sourceBytes: await zip.generateAsync({ type: 'nodebuffer' }),
      filename: 'deck.apkg',
      edits,
    });
    const archive = await extractApkg(result.buffer);
    return {
      before: readRows(input),
      after: readRows(archive.collectionBuffer),
      result,
    };
  }

  it.each([
    {
      noteType: 'Basic, back',
      cardId: 100,
      noteId: 10,
      index: 1,
      expected: ['Q1', 'edited'],
    },
    {
      noteType: 'Basic and reversed, card 1 front',
      cardId: 200,
      noteId: 20,
      index: 0,
      expected: ['edited', 'Oslo'],
    },
    {
      noteType: 'Basic and reversed, card 2 front (the Back field)',
      cardId: 201,
      noteId: 20,
      index: 1,
      expected: ['Capital of Norway', 'edited'],
    },
    {
      noteType: 'Basic and reversed, card 2 back (the Front field)',
      cardId: 201,
      noteId: 20,
      index: 0,
      expected: ['edited', 'Oslo'],
    },
    {
      noteType: 'Cloze, Text on the second cloze card',
      cardId: 301,
      noteId: 30,
      index: 0,
      expected: ['edited', 'extra'],
    },
    {
      noteType: 'three fields, the Meaning back',
      cardId: 400,
      noteId: 40,
      index: 2,
      expected: ['word', 'pron', 'edited'],
    },
    {
      noteType: 'n2a-basic, back',
      cardId: 500,
      noteId: 50,
      index: 1,
      expected: ['front', 'edited', 'media'],
    },
    {
      noteType: 'n2a-mcq, the Extra explanation',
      cardId: 600,
      noteId: 60,
      index: 3,
      expected: ['Capital of Norway?', 'Oslo<br>Bergen', 'Oslo', 'edited'],
    },
  ])(
    'writes $noteType into that field only',
    async ({ cardId, noteId, index, expected }) => {
      const { before, after, result } = await packWith([
        { cardId, fields: [{ index, value: 'edited' }] },
      ]);

      expect(fieldsOf(after, noteId)).toEqual(expected);
      expect(otherNotes(after, noteId)).toEqual(otherNotes(before, noteId));
      expect(after.cards).toEqual(before.cards);
      expect(result).toMatchObject({ notesUpdated: 1, editsRefused: 0 });
    }
  );

  it.each([
    { noteType: 'Cloze Back Extra', cardId: 300, index: 1 },
    { noteType: 'Vocab Pronunciation', cardId: 400, index: 1 },
    { noteType: 'n2a-basic MyMedia', cardId: 500, index: 2 },
    {
      noteType: 'n2a-mcq Multiple Choice, only in a script',
      cardId: 600,
      index: 1,
    },
    {
      noteType: 'n2a-mcq Correct Answer, only in a script',
      cardId: 600,
      index: 2,
    },
    { noteType: 'a field past the end', cardId: 100, index: 5 },
  ])(
    'refuses a field the card does not show for editing: $noteType',
    async ({ cardId, index }) => {
      const { before, after, result } = await packWith([
        { cardId, fields: [{ index, value: 'edited' }] },
      ]);

      expect(after).toEqual(before);
      expect(result).toMatchObject({ notesUpdated: 0, editsRefused: 1 });
    }
  );

  it('edits the card whose id was sent when its deck is not the first', async () => {
    const { before, after } = await packWith([
      { cardId: 101, fields: [{ index: 0, value: 'deck B edit' }] },
    ]);

    expect(fieldsOf(after, 11)).toEqual(['deck B edit', HTML_BACK]);
    expect(otherNotes(after, 11)).toEqual(otherNotes(before, 11));
  });

  it('is not shifted by a card that cannot be shown', async () => {
    const { before, after } = await packWith([
      { cardId: 100, fields: [{ index: 0, value: 'first shown card' }] },
    ]);

    expect(fieldsOf(after, 10)).toEqual(['first shown card', 'A1']);
    expect(after.cards).toEqual(before.cards);
  });

  it('writes nothing when the value equals the stored field', async () => {
    const { before, after, result } = await packWith([
      {
        cardId: 101,
        fields: [
          { index: 0, value: HTML_FRONT },
          { index: 1, value: HTML_BACK },
        ],
      },
    ]);

    expect(after).toEqual(before);
    expect(result.notesUpdated).toBe(0);
  });

  it('keeps HTML, spaces, images and sounds byte for byte in a field it did not edit', async () => {
    const { after } = await packWith([
      { cardId: 101, fields: [{ index: 1, value: 'new back' }] },
    ]);

    expect(Buffer.from(fieldsOf(after, 11)[0])).toEqual(
      Buffer.from(HTML_FRONT)
    );
  });

  it('leaves the note alone when the same card is also deleted', async () => {
    const { before, after, result } = await packWith([
      { cardId: 100, fields: [{ index: 1, value: 'edited' }], deleted: true },
    ]);

    expect(after.notes).toEqual(before.notes);
    expect(after.cards.map((card) => card.id)).not.toContain(100);
    expect(result).toMatchObject({ notesUpdated: 0, cardsDeleted: 1 });
  });

  it('leaves the note alone when a separate edit deletes the card', async () => {
    const { before, after } = await packWith([
      { cardId: 100, fields: [{ index: 1, value: 'edited' }] },
      { cardId: 100, deleted: true },
    ]);

    expect(after.notes).toEqual(before.notes);
  });

  it('skips an unknown card id and still packs the rest', async () => {
    const { before, after, result } = await packWith([
      { cardId: 123456, fields: [{ index: 0, value: 'nowhere' }] },
      { cardId: 100, fields: [{ index: 1, value: 'edited' }] },
    ]);

    expect(fieldsOf(after, 10)).toEqual(['Q1', 'edited']);
    expect(otherNotes(after, 10)).toEqual(otherNotes(before, 10));
    expect(result).toMatchObject({ notesUpdated: 1, editsRefused: 1 });
  });

  it.each([
    ['the field separator', `evil${SEP}shifted`],
    ['a NUL character', `a${String.fromCharCode(0)}b`],
  ])(
    'refuses a value holding %s and keeps the note’s field count',
    async (_label, value) => {
      const { before, after, result } = await packWith([
        { cardId: 100, fields: [{ index: 1, value }] },
      ]);

      expect(fieldsOf(after, 10)).toEqual(['Q1', 'A1']);
      expect(after).toEqual(before);
      expect(result).toMatchObject({ notesUpdated: 0, editsRefused: 1 });
    }
  );

  it.each([
    { order: [200, 201], expected: 'from card 2' },
    { order: [201, 200], expected: 'from card 1' },
  ])(
    'lets the later edit win when both cards of a note change the same field ($order)',
    async ({ order, expected }) => {
      const value = (cardId: number) =>
        cardId === 200 ? 'from card 1' : 'from card 2';
      const { after } = await packWith(
        order.map((cardId) => ({
          cardId,
          fields: [{ index: 0, value: value(cardId) }],
        }))
      );

      expect(fieldsOf(after, 20)).toEqual([expected, 'Oslo']);
    }
  );
});

const EXPORTED_AT_SECS = 1_700_000_000;
const EXPORTED_USN = 7;
const EXPORTED_CSUM = 424242;
const EDITED_AT_MS = 1_800_000_000_999;
const EDITED_AT_SECS = 1_800_000_000;

const SCRIPTED_QFMT = '{{Question}}<script>var c = "{{Choices}}";</script>';
const SCRIPTED_AFMT = '{{FrontSide}}<hr id=answer>{{Extra}}';

function stampExportedRows(db: Database.Database): void {
  db.prepare('UPDATE notes SET mod = ? + id, usn = ?, csum = ?').run(
    EXPORTED_AT_SECS,
    EXPORTED_USN,
    EXPORTED_CSUM
  );
  db.prepare('UPDATE cards SET mod = ? + id, usn = ?').run(
    EXPORTED_AT_SECS,
    EXPORTED_USN
  );
  db.prepare('UPDATE cards SET queue = -1 WHERE id = 101').run();
}

function addSecondCardAndScriptedNote(
  db: Database.Database,
  insertScriptedNote: () => void
): void {
  db.prepare(
    'INSERT INTO cards (id, nid, did, ord) VALUES (104, 10, 2, 1)'
  ).run();
  insertScriptedNote();
  db.prepare(
    'INSERT INTO cards (id, nid, did, ord) VALUES (103, 13, 2, 0)'
  ).run();
}

function buildLegacyExportedCollection(): Buffer {
  const db = new Database(
    buildCollectionBuffer([
      { front: 'Q1', back: 'A1' },
      { front: 'Q2', back: 'A2' },
      { front: 'Q3', back: 'A3' },
    ])
  );
  const { models } = db.prepare('SELECT models FROM col').get() as {
    models: string;
  };
  const scripted = {
    id: 2,
    name: 'Scripted',
    type: 0,
    css: '',
    flds: ['Question', 'Choices', 'Extra'].map((name, ord) => ({ name, ord })),
    tmpls: [
      { name: 'Card 1', ord: 0, qfmt: SCRIPTED_QFMT, afmt: SCRIPTED_AFMT },
    ],
  };
  db.prepare('UPDATE col SET models = ?').run(
    JSON.stringify({ ...JSON.parse(models), '2': scripted })
  );
  addSecondCardAndScriptedNote(db, () =>
    db
      .prepare(
        "INSERT INTO notes (id, guid, mid, tags, flds, sfld) VALUES (13, 'guid3', 2, ' ', ?, 'Q4')"
      )
      .run(['Q4', 'choice a', 'extra'].join(SEP))
  );
  stampExportedRows(db);
  const buf = Buffer.from(db.serialize());
  db.close();
  return buf;
}

const SCHEMA_18_INTEGER_CARD_COLUMNS = [
  'mod',
  'usn',
  'type',
  'queue',
  'due',
  'ivl',
  'factor',
  'reps',
  'lapses',
  'left',
  'odue',
  'odid',
  'flags',
];

function copyRows(
  from: Database.Database,
  to: Database.Database,
  table: string
): void {
  for (const row of from.prepare(`SELECT * FROM ${table}`).all() as Row[]) {
    const columns = Object.keys(row);
    to.prepare(
      `INSERT INTO ${table} (${columns.join(', ')}) VALUES (${columns.map(() => '?').join(', ')})`
    ).run(...columns.map((column) => row[column]));
  }
}

function buildSchema18ExportedCollection(): Buffer {
  const db = new Database(
    buildModernCollection({
      noteType: {
        id: 1,
        name: 'Basic',
        kind: 0,
        css: '',
        fields: ['Front', 'Back'],
        templates: [{ name: 'Card 1', qfmt: '{{Front}}', afmt: '{{Back}}' }],
      },
      deck: { id: 2, name: 'Test' },
      note: { id: 10, fields: ['Q1', 'A1'] },
      cards: [{ id: 100, ord: 0 }],
    })
  );
  for (const column of SCHEMA_18_INTEGER_CARD_COLUMNS) {
    db.exec(
      `ALTER TABLE cards ADD COLUMN ${column} INTEGER NOT NULL DEFAULT 0`
    );
  }
  db.exec("ALTER TABLE cards ADD COLUMN data TEXT NOT NULL DEFAULT ''");
  for (const [id, front, back] of [
    [11, 'Q2', 'A2'],
    [12, 'Q3', 'A3'],
  ] as const) {
    db.prepare(
      "INSERT INTO notes (id, guid, mid, tags, flds, sfld) VALUES (?, ?, 1, '', ?, ?)"
    ).run(id, `g${id}`, [front, back].join(SEP), front);
    db.prepare('INSERT INTO cards (id, nid, did, ord) VALUES (?, ?, 2, 0)').run(
      id + 90,
      id
    );
  }
  const scripted = new Database(
    buildModernCollection({
      noteType: {
        id: 2,
        name: 'Scripted',
        kind: 0,
        css: '',
        fields: ['Question', 'Choices', 'Extra'],
        templates: [
          { name: 'Card 1', qfmt: SCRIPTED_QFMT, afmt: SCRIPTED_AFMT },
        ],
      },
      deck: { id: 2, name: 'Test' },
      note: { id: 13, fields: ['Q4', 'choice a', 'extra'] },
      cards: [],
    })
  );
  addSecondCardAndScriptedNote(db, () => {
    for (const table of ['notetypes', 'fields', 'templates', 'notes']) {
      copyRows(scripted, db, table);
    }
  });
  scripted.close();
  stampExportedRows(db);
  const buf = Buffer.from(db.serialize());
  db.close();
  return buf;
}

async function packageCollection(
  collectionName: string,
  sqlite: Buffer
): Promise<Buffer> {
  const zip = new JSZip();
  if (collectionName === 'collection.anki21b') {
    zip.file('meta', LATEST_PACKAGE_META);
    zip.file('collection.anki21b', zlib.zstdCompressSync(sqlite));
    zip.file('collection.anki2', buildCollectionBuffer([PLACEHOLDER_CARD]));
    zip.file('media', zlib.zstdCompressSync(Buffer.alloc(0)));
  } else {
    zip.file(collectionName, sqlite);
    zip.file('media', '{}');
  }
  return zip.generateAsync({ type: 'nodebuffer' });
}

function rowOf(rows: Row[], id: number): Row | undefined {
  return rows.find((row) => row.id === id);
}

function withoutId(rows: Row[], id: number): Row[] {
  return rows.filter((row) => row.id !== id);
}

describe.each([
  {
    format: 'a legacy collection.anki2',
    collectionName: 'collection.anki2',
    build: buildLegacyExportedCollection,
  },
  {
    format: 'a schema-18 collection.anki21b',
    collectionName: 'collection.anki21b',
    build: buildSchema18ExportedCollection,
  },
])(
  'PackEditedApkgUseCase re-import markers for $format',
  ({ collectionName, build }) => {
    const clockedUseCase = new PackEditedApkgUseCase(() => EDITED_AT_MS);

    async function packWith(edits: CardEdit[]) {
      const input = build();
      const result = await clockedUseCase.execute({
        sourceBytes: await packageCollection(collectionName, input),
        filename: 'deck.apkg',
        edits,
      });
      const archive = await extractApkg(result.buffer);
      return {
        before: readRows(input),
        after: readRows(archive.collectionBuffer),
        archive,
        result,
      };
    }

    it('stamps an edited note with the edit time in seconds and a local-change usn', async () => {
      const { before, after } = await packWith([
        { cardId: 101, fields: [{ index: 0, value: 'edited front' }] },
      ]);

      expect(rowOf(after.notes, 11)).toEqual({
        ...rowOf(before.notes, 11),
        flds: ['edited front', 'A2'].join(SEP),
        mod: EDITED_AT_SECS,
        usn: -1,
      });
    });

    it('keeps every other note and every card row as it was', async () => {
      const { before, after } = await packWith([
        { cardId: 101, fields: [{ index: 0, value: 'edited front' }] },
      ]);

      expect(withoutId(after.notes, 11)).toEqual(withoutId(before.notes, 11));
      expect(after.cards).toEqual(before.cards);
    });

    it('leaves every card as it was when an older page still sends a suspend flag', async () => {
      const staleSuspend = { cardId: 102, suspended: true } as CardEdit;

      const { before, after, result } = await packWith([staleSuspend]);

      expect(after).toEqual(before);
      expect(result).toMatchObject({ notesUpdated: 0, cardsDeleted: 0 });
    });

    it('keeps a card the deck already had suspended as it was', async () => {
      const { before, after } = await packWith([
        { cardId: 100, fields: [{ index: 0, value: 'edited' }] },
      ]);

      expect(rowOf(after.cards, 101)).toEqual(rowOf(before.cards, 101));
      expect(rowOf(after.cards, 101)?.queue).toBe(-1);
    });

    it('stamps nothing when an edit leaves the text as it was', async () => {
      const { before, after } = await packWith([
        {
          cardId: 101,
          fields: [
            { index: 0, value: 'Q2' },
            { index: 1, value: 'A2' },
          ],
        },
      ]);

      expect(after).toEqual(before);
    });

    it.each([
      [
        'a value holding the field separator',
        { cardId: 100, fields: [{ index: 0, value: `a${SEP}b` }] },
      ],
      [
        'a field referenced only inside a script',
        { cardId: 103, fields: [{ index: 1, value: 'choice b' }] },
      ],
      [
        'an unknown card id',
        { cardId: 999, fields: [{ index: 0, value: 'nowhere' }] },
      ],
    ])('stamps nothing for an edit refused for %s', async (_label, edit) => {
      const { before, after, result } = await packWith([edit]);

      expect(after).toEqual(before);
      expect(result).toMatchObject({ notesUpdated: 0, editsRefused: 1 });
    });

    it('stamps a note once when two of its cards change the same field', async () => {
      const { before, after, result } = await packWith([
        { cardId: 100, fields: [{ index: 0, value: 'from card 100' }] },
        { cardId: 104, fields: [{ index: 0, value: 'from card 104' }] },
      ]);

      expect(rowOf(after.notes, 10)).toEqual({
        ...rowOf(before.notes, 10),
        flds: ['from card 104', 'A1'].join(SEP),
        mod: EDITED_AT_SECS,
        usn: -1,
      });
      expect(result.notesUpdated).toBe(1);
    });

    it('stamps nothing when a later edit puts the text back', async () => {
      const { before, after, result } = await packWith([
        { cardId: 100, fields: [{ index: 0, value: 'changed' }] },
        { cardId: 104, fields: [{ index: 0, value: 'Q1' }] },
      ]);

      expect(after).toEqual(before);
      expect(result.notesUpdated).toBe(0);
    });

    it('leaves the note of a deleted card unstamped', async () => {
      const { before, after } = await packWith([
        {
          cardId: 102,
          fields: [{ index: 0, value: 'edited' }],
          deleted: true,
        },
      ]);

      expect(after.notes).toEqual(before.notes);
      expect(after.cards).toEqual(withoutId(before.cards, 102));
    });

    it('stamps every note edited in one download', async () => {
      const { after } = await packWith([
        { cardId: 100, fields: [{ index: 0, value: 'first edit' }] },
        { cardId: 102, fields: [{ index: 1, value: 'second edit' }] },
        { cardId: 103, fields: [{ index: 2, value: 'third edit' }] },
      ]);

      expect(after.notes.map(({ id, mod, usn }) => ({ id, mod, usn }))).toEqual(
        [
          { id: 10, mod: EDITED_AT_SECS, usn: -1 },
          { id: 11, mod: EXPORTED_AT_SECS + 11, usn: EXPORTED_USN },
          { id: 12, mod: EDITED_AT_SECS, usn: -1 },
          { id: 13, mod: EDITED_AT_SECS, usn: -1 },
        ]
      );
    });

    it('reads back through extractApkg and parseCollection with the edit', async () => {
      const { archive } = await packWith([
        { cardId: 101, fields: [{ index: 0, value: 'edited front' }] },
      ]);

      expect(archive.collectionName).toBe(collectionName);
      expect(
        parseCollection(archive.collectionBuffer).notes.get(11)?.fields
      ).toEqual(['edited front', 'A2']);
    });
  }
);
