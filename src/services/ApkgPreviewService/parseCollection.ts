import Database from 'better-sqlite3';
import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';

import { readString, readVarint } from './protobuf';
import { Card, Deck, NormalizedCollection, Note, NoteType } from './types';

// anki/proto/notetypes.proto — Notetype.Config: `Kind kind = 1` (0 normal,
// 1 cloze), `string css = 3`.
const NOTETYPE_CONFIG_KIND_FIELD = 1;
const NOTETYPE_CONFIG_CSS_FIELD = 3;
const NOTETYPE_KIND_CLOZE = 1;

interface LegacyModelJson {
  id: number | string;
  name: string;
  type?: number;
  css?: string;
  flds: Array<{ name: string; ord: number }>;
  tmpls: Array<{ name: string; ord: number; qfmt: string; afmt: string }>;
}

interface LegacyDeckJson {
  id: number | string;
  name: string;
}

function patchUnicaseCollation(buffer: Buffer): Buffer {
  const UNICASE = Buffer.from('COLLATE unicase');
  const REPLACE = Buffer.from('COLLATE BINARY ');
  let pos = 0;
  while (pos < buffer.length) {
    const idx = buffer.indexOf(UNICASE, pos);
    if (idx === -1) break;
    REPLACE.copy(buffer, idx);
    pos = idx + REPLACE.length;
  }
  return buffer;
}

function writeTempDb(buffer: Buffer): string {
  const tempPath = path.join(
    os.tmpdir(),
    `apkg-${Date.now()}-${crypto.randomUUID()}.sqlite`
  );
  fs.writeFileSync(tempPath, buffer);
  return tempPath;
}

function openCollection(buffer: Buffer): {
  db: Database.Database;
  cleanup: () => void;
} {
  const tempPath = writeTempDb(buffer);
  const raw = fs.readFileSync(tempPath);
  patchUnicaseCollation(raw);
  fs.writeFileSync(tempPath, raw);
  const db = new Database(tempPath, { readonly: true, fileMustExist: true });
  return {
    db,
    cleanup: () => {
      try {
        db.close();
      } finally {
        fs.unlinkSync(tempPath);
      }
    },
  };
}

function hasTable(db: Database.Database, table: string): boolean {
  const row = db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name = ?")
    .get(table);
  return row != null;
}

function loadLegacyNoteTypes(db: Database.Database): Map<number, NoteType> {
  const row = db.prepare('SELECT models FROM col LIMIT 1').get() as
    | { models: string }
    | undefined;
  if (!row) return new Map();
  const parsed = JSON.parse(row.models) as Record<string, LegacyModelJson>;
  const map = new Map<number, NoteType>();
  for (const value of Object.values(parsed)) {
    const id = Number(value.id);
    map.set(id, {
      id,
      name: value.name,
      type: value.type === 1 ? 1 : 0,
      css: value.css ?? '',
      fields: value.flds.map((field) => ({
        name: field.name,
        ord: field.ord,
      })),
      templates: value.tmpls.map((tmpl) => ({
        name: tmpl.name,
        ord: tmpl.ord,
        qfmt: tmpl.qfmt,
        afmt: tmpl.afmt,
      })),
    });
  }
  return map;
}

function loadLegacyDecks(db: Database.Database): Map<number, Deck> {
  const row = db.prepare('SELECT decks FROM col LIMIT 1').get() as
    | { decks: string }
    | undefined;
  const map = new Map<number, Deck>();
  if (!row) return map;
  const parsed = JSON.parse(row.decks) as Record<string, LegacyDeckJson>;
  for (const value of Object.values(parsed)) {
    const id = Number(value.id);
    map.set(id, { id, name: value.name });
  }
  return map;
}

function getTableColumns(db: Database.Database, table: string): Set<string> {
  const rows = db
    .prepare(`SELECT name FROM pragma_table_info('${table}')`)
    .all() as Array<{ name: string }>;
  return new Set(rows.map((r) => r.name));
}

function safeQueryAll<T>(
  db: Database.Database,
  table: string,
  wantedCols: string[],
  suffix: string
): T[] {
  const existing = getTableColumns(db, table);
  const cols = wantedCols.filter((c) => existing.has(c));
  if (cols.length === 0) return [];
  return db
    .prepare(`SELECT ${cols.join(', ')} FROM ${table} ${suffix}`)
    .all() as T[];
}

function loadModernNoteTypes(db: Database.Database): Map<number, NoteType> {
  const noteTypeRows = safeQueryAll<{
    id: number;
    name: string;
    mtype?: number;
    config?: Buffer;
  }>(db, 'notetypes', ['id', 'name', 'mtype', 'config'], '');
  const hasFieldsTable = hasTable(db, 'fields');
  const hasTemplatesTable = hasTable(db, 'templates');

  const fieldRows = hasFieldsTable
    ? safeQueryAll<{ ntid: number; name: string; ord: number }>(
        db,
        'fields',
        ['ntid', 'name', 'ord'],
        'ORDER BY ntid, ord'
      )
    : [];
  const templateRows = hasTemplatesTable
    ? safeQueryAll<{ ntid: number; name: string; ord: number; config: Buffer }>(
        db,
        'templates',
        ['ntid', 'name', 'ord', 'config'],
        'ORDER BY ntid, ord'
      )
    : [];

  const map = new Map<number, NoteType>();
  for (const row of noteTypeRows) {
    const cfg = row.config;
    const css = cfg ? readString(cfg, NOTETYPE_CONFIG_CSS_FIELD) : '';
    // Schema 18 has no `mtype` column — the kind lives in the config blob.
    // Keep `mtype` as a fallback for any intermediate schema that has it.
    const kind =
      (cfg ? readVarint(cfg, NOTETYPE_CONFIG_KIND_FIELD) : undefined) ??
      row.mtype ??
      0;
    map.set(row.id, {
      id: row.id,
      name: row.name,
      type: kind === NOTETYPE_KIND_CLOZE ? 1 : 0,
      css,
      fields: [],
      templates: [],
    });
  }
  for (const field of fieldRows) {
    map.get(field.ntid)?.fields.push({ name: field.name, ord: field.ord });
  }
  for (const tmpl of templateRows) {
    const cfg = tmpl.config;
    const qfmt = cfg ? readString(cfg, 1) : '';
    const afmt = cfg ? readString(cfg, 2) : '';
    map.get(tmpl.ntid)?.templates.push({
      name: tmpl.name,
      ord: tmpl.ord,
      qfmt,
      afmt,
    });
  }
  return map;
}

function loadModernDecks(db: Database.Database): Map<number, Deck> {
  const rows = db.prepare('SELECT id, name FROM decks').all() as Array<{
    id: number;
    name: string;
  }>;
  const map = new Map<number, Deck>();
  for (const row of rows) {
    map.set(row.id, { id: row.id, name: row.name });
  }
  return map;
}

function loadNotes(db: Database.Database): Map<number, Note> {
  const hasGuidColumn = db
    .prepare(
      "SELECT 1 FROM pragma_table_info('notes') WHERE name = 'guid' LIMIT 1"
    )
    .get();
  const columns = hasGuidColumn
    ? 'id, mid, tags, flds, guid'
    : 'id, mid, tags, flds';
  const rows = db.prepare(`SELECT ${columns} FROM notes`).all() as Array<{
    id: number;
    mid: number;
    tags: string;
    flds: string;
    guid?: string;
  }>;
  const map = new Map<number, Note>();
  for (const row of rows) {
    map.set(row.id, {
      id: row.id,
      mid: row.mid,
      tags: row.tags,
      fields: row.flds.split('\x1f'),
      guid: row.guid,
    });
  }
  return map;
}

function loadCards(db: Database.Database): Card[] {
  const rows = db
    .prepare('SELECT id, nid, did, ord FROM cards ORDER BY id')
    .all() as Array<{ id: number; nid: number; did: number; ord: number }>;
  return rows.map((row) => ({
    id: row.id,
    nid: row.nid,
    did: row.did,
    ord: row.ord,
  }));
}

export function parseCollection(buffer: Buffer): NormalizedCollection {
  const { db, cleanup } = openCollection(buffer);
  try {
    const modernSchema = hasTable(db, 'notetypes');
    const noteTypes = modernSchema
      ? loadModernNoteTypes(db)
      : loadLegacyNoteTypes(db);
    const decks = modernSchema ? loadModernDecks(db) : loadLegacyDecks(db);
    const notes = loadNotes(db);
    const cards = loadCards(db);
    return { noteTypes, notes, decks, cards };
  } finally {
    cleanup();
  }
}
