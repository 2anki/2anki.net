import Database from 'better-sqlite3';

// Builds an in-memory Anki schema-18 collection (the `collection.anki21b`
// layout): note type kind/css live in a NotetypeConfig protobuf blob and
// templates in a TemplateConfig blob — there is no `mtype` column.

function encodeVarint(value: number): Buffer {
  const bytes: number[] = [];
  let v = value;
  while (v > 0x7f) {
    bytes.push((v & 0x7f) | 0x80);
    v >>>= 7;
  }
  bytes.push(v);
  return Buffer.from(bytes);
}

function varintField(fieldNumber: number, value: number): Buffer {
  return Buffer.concat([encodeVarint(fieldNumber << 3), encodeVarint(value)]);
}

function stringField(fieldNumber: number, value: string): Buffer {
  const data = Buffer.from(value, 'utf8');
  return Buffer.concat([
    encodeVarint((fieldNumber << 3) | 2),
    encodeVarint(data.length),
    data,
  ]);
}

export interface ModernNoteTypeFixture {
  id: number;
  name: string;
  // NotetypeConfig.kind: 0 = normal, 1 = cloze. Omitted from the blob when
  // 0, as proto3 does for default values.
  kind: 0 | 1;
  css: string;
  fields: string[];
  templates: Array<{ name: string; qfmt: string; afmt: string }>;
}

export interface ModernCollectionFixture {
  noteType: ModernNoteTypeFixture;
  deck: { id: number; name: string };
  note: { id: number; fields: string[] };
  cards: Array<{ id: number; ord: number }>;
}

export function buildModernCollection(fixture: ModernCollectionFixture): Buffer {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE notetypes (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      mtime_secs INTEGER NOT NULL DEFAULT 0,
      usn INTEGER NOT NULL DEFAULT 0,
      config BLOB NOT NULL
    );
    CREATE TABLE fields (
      ntid INTEGER NOT NULL,
      ord INTEGER NOT NULL,
      name TEXT NOT NULL,
      config BLOB NOT NULL,
      PRIMARY KEY (ntid, ord)
    );
    CREATE TABLE templates (
      ntid INTEGER NOT NULL,
      ord INTEGER NOT NULL,
      name TEXT NOT NULL,
      mtime_secs INTEGER NOT NULL DEFAULT 0,
      usn INTEGER NOT NULL DEFAULT 0,
      config BLOB NOT NULL,
      PRIMARY KEY (ntid, ord)
    );
    CREATE TABLE decks (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      mtime_secs INTEGER NOT NULL DEFAULT 0,
      usn INTEGER NOT NULL DEFAULT 0,
      common BLOB NOT NULL DEFAULT x'',
      kind BLOB NOT NULL DEFAULT x''
    );
    CREATE TABLE notes (
      id INTEGER PRIMARY KEY,
      guid TEXT NOT NULL,
      mid INTEGER NOT NULL,
      mod INTEGER NOT NULL DEFAULT 0,
      usn INTEGER NOT NULL DEFAULT 0,
      tags TEXT NOT NULL,
      flds TEXT NOT NULL,
      sfld TEXT NOT NULL DEFAULT '',
      csum INTEGER NOT NULL DEFAULT 0,
      flags INTEGER NOT NULL DEFAULT 0,
      data TEXT NOT NULL DEFAULT ''
    );
    CREATE TABLE cards (
      id INTEGER PRIMARY KEY,
      nid INTEGER NOT NULL,
      did INTEGER NOT NULL,
      ord INTEGER NOT NULL
    );
  `);

  const { noteType, deck, note, cards } = fixture;
  const notetypeConfig = Buffer.concat([
    noteType.kind === 0 ? Buffer.alloc(0) : varintField(1, noteType.kind),
    varintField(2, 0),
    stringField(3, noteType.css),
  ]);
  db.prepare('INSERT INTO notetypes (id, name, config) VALUES (?, ?, ?)').run(
    noteType.id,
    noteType.name,
    notetypeConfig
  );
  noteType.fields.forEach((name, ord) => {
    db.prepare(
      'INSERT INTO fields (ntid, ord, name, config) VALUES (?, ?, ?, ?)'
    ).run(noteType.id, ord, name, Buffer.alloc(0));
  });
  noteType.templates.forEach((tmpl, ord) => {
    const config = Buffer.concat([
      stringField(1, tmpl.qfmt),
      stringField(2, tmpl.afmt),
    ]);
    db.prepare(
      'INSERT INTO templates (ntid, ord, name, config) VALUES (?, ?, ?, ?)'
    ).run(noteType.id, ord, tmpl.name, config);
  });
  db.prepare('INSERT INTO decks (id, name) VALUES (?, ?)').run(
    deck.id,
    deck.name
  );
  db.prepare(
    "INSERT INTO notes (id, guid, mid, tags, flds) VALUES (?, 'g', ?, '', ?)"
  ).run(note.id, noteType.id, note.fields.join('\x1f'));
  for (const card of cards) {
    db.prepare('INSERT INTO cards (id, nid, did, ord) VALUES (?, ?, ?, ?)').run(
      card.id,
      note.id,
      deck.id,
      card.ord
    );
  }

  const buf = db.serialize();
  db.close();
  return Buffer.from(buf);
}
