import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { promisify } from 'node:util';
import zlib from 'node:zlib';
import Database from 'better-sqlite3';
import { createZipArchive } from '../../lib/archiver/createZipArchive';
import {
  ApkgArchive,
  extractApkg,
} from '../../services/ApkgPreviewService/extractApkg';
import { parseCollection } from '../../services/ApkgPreviewService/parseCollection';
import { resolveEditableFields } from '../../services/ApkgPreviewService/resolveEditableFields';
import {
  Card,
  NormalizedCollection,
} from '../../services/ApkgPreviewService/types';

const zstdCompress = promisify(zlib.zstdCompress);

const NEW_FORMAT_COLLECTION = 'collection.anki21b';

export interface FieldEdit {
  index: number;
  value: string;
}

export interface CardEdit {
  cardId: number;
  fields?: FieldEdit[];
  deleted?: boolean;
  suspended?: boolean;
}

export interface PackEditedApkgInput {
  sourceBytes: Buffer;
  filename: string;
  edits: CardEdit[];
}

export interface EditCounts {
  notesUpdated: number;
  cardsSuspended: number;
  cardsDeleted: number;
  editsRefused: number;
}

export interface PackEditedApkgOutput extends EditCounts {
  buffer: Buffer;
  filename: string;
  collectionName: string;
}

const FIELD_SEPARATOR = '\x1f';

function writeTempFile(buffer: Buffer, suffix: string): string {
  const p = path.join(os.tmpdir(), `apkg-edit-${crypto.randomUUID()}${suffix}`);
  fs.writeFileSync(p, buffer);
  return p;
}

function editableFieldIndices(
  collection: NormalizedCollection,
  card: Card
): Set<number> {
  const note = collection.notes.get(card.nid);
  const noteType = note ? collection.noteTypes.get(note.mid) : undefined;
  if (noteType == null) return new Set();
  const { front, back } = resolveEditableFields(noteType, card.ord);
  return new Set(
    [front, back].flatMap((side) => (side ? [side.fieldIndex] : []))
  );
}

function applyEdits(
  db: Database.Database,
  collection: NormalizedCollection,
  edits: CardEdit[]
): EditCounts {
  const cardsById = new Map(collection.cards.map((card) => [card.id, card]));
  const counts: EditCounts = {
    notesUpdated: 0,
    cardsSuspended: 0,
    cardsDeleted: 0,
    editsRefused: 0,
  };
  const deletedIds = new Set(
    edits
      .filter((edit) => edit.deleted && cardsById.has(edit.cardId))
      .map((edit) => edit.cardId)
  );
  const updatedNoteIds = new Set<number>();
  const readFields = db.prepare('SELECT flds FROM notes WHERE id = ?');
  const writeFields = db.prepare('UPDATE notes SET flds = ? WHERE id = ?');

  for (const edit of edits) {
    const card = cardsById.get(edit.cardId);
    if (card == null) {
      counts.editsRefused += 1;
    } else if (!deletedIds.has(card.id)) {
      if (edit.suspended) {
        counts.cardsSuspended += db
          .prepare('UPDATE cards SET queue = -1 WHERE id = ?')
          .run(card.id).changes;
      }
      const allowed = editableFieldIndices(collection, card);
      const row = readFields.get(card.nid) as { flds: string } | undefined;
      if (row != null && edit.fields != null) {
        const fields = row.flds.split(FIELD_SEPARATOR);
        for (const field of edit.fields) {
          if (allowed.has(field.index) && field.index < fields.length) {
            fields[field.index] = field.value;
          } else {
            counts.editsRefused += 1;
          }
        }
        const edited = fields.join(FIELD_SEPARATOR);
        if (edited !== row.flds) {
          writeFields.run(edited, card.nid);
          updatedNoteIds.add(card.nid);
        }
      }
    }
  }

  const remove = db.prepare('DELETE FROM cards WHERE id = ?');
  for (const cardId of deletedIds) {
    counts.cardsDeleted += remove.run(cardId).changes;
  }
  counts.notesUpdated = updatedNoteIds.size;
  return counts;
}

function buildEditedSqlite(
  collectionBuffer: Buffer,
  edits: CardEdit[]
): { sqlite: Buffer; counts: EditCounts } {
  const collection = parseCollection(collectionBuffer);
  const tempPath = writeTempFile(collectionBuffer, '.sqlite');
  try {
    const db = new Database(tempPath);
    let counts: EditCounts;
    try {
      counts = db.transaction(() => applyEdits(db, collection, edits))();
    } finally {
      db.close();
    }
    return { sqlite: fs.readFileSync(tempPath), counts };
  } finally {
    fs.unlinkSync(tempPath);
  }
}

async function buildEntries(
  archive: ApkgArchive,
  editedCollection: Buffer
): Promise<Map<string, Buffer>> {
  const entries = new Map<string, Buffer>();
  if (archive.collectionName === NEW_FORMAT_COLLECTION) {
    for (const [name, stored] of archive.passthroughEntries) {
      entries.set(name, stored);
    }
    entries.set(NEW_FORMAT_COLLECTION, await zstdCompress(editedCollection));
    entries.set(
      'media',
      archive.mediaManifestRaw ?? (await zstdCompress(Buffer.alloc(0)))
    );
  } else {
    entries.set(archive.collectionName, editedCollection);
    entries.set('media', archive.mediaManifestRaw ?? Buffer.from('{}'));
  }
  for (const [name, data] of archive.mediaEntries) {
    entries.set(name, data);
  }
  return entries;
}

async function packApkg(entries: Map<string, Buffer>): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const archive = createZipArchive({ store: true });
    const chunks: Buffer[] = [];

    archive.on('data', (chunk: Buffer) => chunks.push(chunk));
    archive.on('end', () => resolve(Buffer.concat(chunks)));
    archive.on('error', reject);
    archive.on('warning', (err: Error) => {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') reject(err);
    });

    for (const [name, data] of entries) {
      archive.append(data, { name });
    }

    archive.finalize();
  });
}

export default class PackEditedApkgUseCase {
  async execute(input: PackEditedApkgInput): Promise<PackEditedApkgOutput> {
    const { sourceBytes, filename, edits } = input;
    const archive = await extractApkg(sourceBytes);

    const edited = buildEditedSqlite(archive.collectionBuffer, edits);

    const apkgBuffer = await packApkg(
      await buildEntries(archive, edited.sqlite)
    );

    const baseName = filename.replace(/\.apkg$/i, '');
    return {
      buffer: apkgBuffer,
      filename: `${baseName}-edited.apkg`,
      collectionName: archive.collectionName,
      ...edited.counts,
    };
  }
}
