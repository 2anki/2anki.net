import Database from 'better-sqlite3';
import { buildModernCollection } from '../../test/fixtures/apkg/buildModernCollection';
import { parseCollection } from './parseCollection';

function buildLegacyCollection(): Buffer {
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
      guid TEXT,
      mid INTEGER,
      mod INTEGER,
      usn INTEGER,
      tags TEXT,
      flds TEXT,
      sfld TEXT,
      csum INTEGER,
      flags INTEGER,
      data TEXT
    );
    CREATE TABLE cards (
      id INTEGER PRIMARY KEY,
      nid INTEGER,
      did INTEGER,
      ord INTEGER,
      mod INTEGER,
      usn INTEGER,
      type INTEGER,
      queue INTEGER,
      due INTEGER,
      ivl INTEGER,
      factor INTEGER,
      reps INTEGER,
      lapses INTEGER,
      left INTEGER,
      odue INTEGER,
      odid INTEGER,
      flags INTEGER,
      data TEXT
    );
  `);

  const models = {
    '1': {
      id: 1,
      name: 'Basic',
      type: 0,
      css: '.card { font-family: arial; }',
      flds: [
        { name: 'Front', ord: 0 },
        { name: 'Back', ord: 1 },
      ],
      tmpls: [
        {
          name: 'Card 1',
          ord: 0,
          qfmt: '{{Front}}',
          afmt: '{{FrontSide}}<hr>{{Back}}',
        },
      ],
    },
  };
  const decks = {
    '2': { id: 2, name: 'Demo' },
  };
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

  const buf = db.serialize();
  db.close();
  return Buffer.from(buf);
}

describe('parseCollection — legacy schema', () => {
  it('loads note types, notes, and cards from a legacy col row', () => {
    const result = parseCollection(buildLegacyCollection());

    expect(result.noteTypes.size).toBe(1);
    const noteType = result.noteTypes.get(1);
    expect(noteType?.name).toBe('Basic');
    expect(noteType?.fields.map((f) => f.name)).toEqual(['Front', 'Back']);
    expect(noteType?.templates[0]?.qfmt).toBe('{{Front}}');
    expect(noteType?.css).toContain('.card');

    expect(result.notes.size).toBe(1);
    expect(result.notes.get(10)?.fields).toEqual(['hello', 'world']);

    expect(result.decks.get(2)?.name).toBe('Demo');

    expect(result.cards).toHaveLength(1);
    expect(result.cards[0]).toMatchObject({ id: 100, nid: 10, did: 2, ord: 0 });
  });
});

describe('parseCollection — modern schema (collection.anki21b)', () => {
  function modernFixture(kind: 0 | 1) {
    return buildModernCollection({
      noteType: {
        id: 1,
        name: kind === 1 ? 'Cloze' : 'Basic',
        kind,
        css: '.card { color: black; }',
        fields: ['Text', 'Extra'],
        templates: [{ name: 'Card 1', qfmt: '{{Text}}', afmt: '{{Extra}}' }],
      },
      deck: { id: 2, name: 'Demo' },
      note: { id: 10, fields: ['front', 'back'] },
      cards: [{ id: 100, ord: 0 }],
    });
  }

  it('reads the cloze kind from the notetype config blob', () => {
    const result = parseCollection(modernFixture(1));

    expect(result.noteTypes.get(1)?.type).toBe(1);
  });

  it('treats a config blob without a kind field as a normal note type', () => {
    const result = parseCollection(modernFixture(0));

    expect(result.noteTypes.get(1)?.type).toBe(0);
  });

  it('still reads css and templates from the config blobs', () => {
    const noteType = parseCollection(modernFixture(1)).noteTypes.get(1);

    expect(noteType?.css).toBe('.card { color: black; }');
    expect(noteType?.templates[0]).toMatchObject({
      qfmt: '{{Text}}',
      afmt: '{{Extra}}',
    });
  });
});
