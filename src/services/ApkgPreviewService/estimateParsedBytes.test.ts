import Database from 'better-sqlite3';
import { zipSync } from 'fflate';
import { runInNewContext } from 'node:vm';
import v8 from 'node:v8';

import { buildModernCollection } from '../../test/fixtures/apkg/buildModernCollection';
import {
  estimateParsedBytes,
  estimateStringBytes,
} from './estimateParsedBytes';
import { extractApkg, parseMediaManifest } from './extractApkg';
import { parseCollection } from './parseCollection';
import type { ParsedApkg } from './ApkgPreviewService';

v8.setFlagsFromString('--expose-gc');
const collectGarbage = runInNewContext('gc') as () => void;

function retainedHeapBytes(): number {
  collectGarbage();
  collectGarbage();
  const usage = process.memoryUsage();
  return usage.heapUsed + usage.arrayBuffers;
}

const FIELD_SEPARATOR = String.fromCharCode(31);
const MEDIA_BYTES = 256 * 1024;

interface DeckShape {
  notes: number;
  wordsPerField: number;
  media: number;
  unicode: boolean;
}

function fieldText(shape: DeckShape, index: number): string {
  const word = shape.unicode ? 'Größe ✓ 漢字 ' : 'mitochondria ';
  return `${word.repeat(shape.wordsPerField)}#${index}`;
}

function buildApkg(shape: DeckShape): Buffer {
  const base = buildModernCollection({
    noteType: {
      id: 1,
      name: 'Basic',
      kind: 0,
      css: '.card { color: black; }',
      fields: ['Front', 'Back'],
      templates: [{ name: 'Card 1', qfmt: '{{Front}}', afmt: '{{Back}}' }],
    },
    deck: { id: 2, name: 'Biology' },
    note: { id: 1, fields: ['seed', 'seed'] },
    cards: [{ id: 1, ord: 0 }],
  });
  const db = new Database(base);
  const insertNote = db.prepare(
    "INSERT INTO notes (id, guid, mid, tags, flds) VALUES (?, ?, 1, 'bio cell', ?)"
  );
  const insertCard = db.prepare(
    'INSERT INTO cards (id, nid, did, ord) VALUES (?, ?, 2, 0)'
  );
  db.transaction(() => {
    for (let i = 0; i < shape.notes; i += 1) {
      const id = 1_700_000_000_000 + i;
      const fields = [fieldText(shape, i), fieldText(shape, i + 1)];
      insertNote.run(id, `guid-${i}`, fields.join(FIELD_SEPARATOR));
      insertCard.run(id + 5_000_000, id);
    }
  })();
  const collection = db.serialize();
  db.close();

  const files: Record<string, Uint8Array> = {
    'collection.anki21': new Uint8Array(collection),
  };
  const manifest: Record<string, string> = {};
  for (let i = 0; i < shape.media; i += 1) {
    files[String(i)] = new Uint8Array(MEDIA_BYTES).fill(i + 1);
    manifest[String(i)] = `image-${i}.png`;
  }
  files.media = new TextEncoder().encode(JSON.stringify(manifest));
  return Buffer.from(zipSync(files, { level: 0 }));
}

async function parse(bytes: Buffer): Promise<ParsedApkg> {
  const archive = await extractApkg(bytes);
  return {
    collection: parseCollection(archive.collectionBuffer),
    mediaMap: parseMediaManifest(archive.mediaManifestRaw),
    mediaEntries: archive.mediaEntries,
    parsedAt: 0,
  };
}

describe('estimateStringBytes', () => {
  it('counts one byte per character for Latin-1 text', () => {
    expect(estimateStringBytes('a'.repeat(1000))).toBe(16 + 1000);
  });

  it('counts two bytes per character once any character is outside Latin-1', () => {
    expect(estimateStringBytes(`${'a'.repeat(999)}✓`)).toBe(16 + 2000);
  });
});

describe('estimateParsedBytes', () => {
  it('counts every media entry at its full length', async () => {
    const parsed = await parse(
      buildApkg({ notes: 10, wordsPerField: 1, media: 8, unicode: false })
    );

    expect(estimateParsedBytes(parsed)).toBeGreaterThan(8 * MEDIA_BYTES);
  });

  it.each<[string, DeckShape]>([
    [
      'text and media',
      { notes: 4000, wordsPerField: 60, media: 16, unicode: false },
    ],
    [
      'text outside Latin-1',
      { notes: 4000, wordsPerField: 60, media: 0, unicode: true },
    ],
    [
      'many short notes',
      { notes: 40000, wordsPerField: 2, media: 0, unicode: false },
    ],
  ])(
    'stays within a fifth of the heap a parsed deck of %s really retains',
    async (_label, shape) => {
      const bytes = buildApkg(shape);
      const before = retainedHeapBytes();
      const parsed = await parse(bytes);
      const retained = retainedHeapBytes() - before;

      const ratio = estimateParsedBytes(parsed) / retained;

      expect(ratio).toBeGreaterThan(0.8);
      expect(ratio).toBeLessThan(1.2);
    },
    20_000
  );
});
