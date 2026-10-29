import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { unzipSync, zipSync } from 'fflate';

import { pinSharedNoteTypes } from './pinSharedNoteTypes';

// NOTETYPE_MOD in create_deck/helpers/n2a_model.py.
const NOTETYPE_MOD = 1792838415;

function apkgWithNoteTypeMod(mod: number): Buffer {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pin-test-'));
  const file = path.join(dir, 'collection.anki2');
  const db = new Database(file);
  db.exec('CREATE TABLE col (models TEXT)');
  db.prepare('INSERT INTO col (models) VALUES (?)').run(
    JSON.stringify({ '1': { id: 1, name: 'n2a-basic', mod } })
  );
  db.close();
  const collection = fs.readFileSync(file);
  fs.rmSync(dir, { recursive: true, force: true });
  return Buffer.from(
    zipSync({
      'collection.anki2': collection,
      media: new TextEncoder().encode('{}'),
    })
  );
}

function noteTypeMods(apkg: Buffer): number[] {
  const entries = unzipSync(new Uint8Array(apkg));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pin-read-'));
  const file = path.join(dir, 'collection.anki2');
  fs.writeFileSync(file, entries['collection.anki2']);
  const db = new Database(file, { readonly: true });
  const row = db.prepare('SELECT models FROM col').get() as { models: string };
  db.close();
  fs.rmSync(dir, { recursive: true, force: true });
  return Object.values(
    JSON.parse(row.models) as Record<string, { mod: number }>
  ).map((notetype) => notetype.mod);
}

describe('pinSharedNoteTypes', () => {
  it('brings a newer note type mod back to the shared one', async () => {
    const pinned = await pinSharedNoteTypes(
      apkgWithNoteTypeMod(NOTETYPE_MOD + 600)
    );

    expect(noteTypeMods(pinned)).toEqual([NOTETYPE_MOD]);
  });

  it('keeps the other files of the package', async () => {
    const pinned = await pinSharedNoteTypes(
      apkgWithNoteTypeMod(NOTETYPE_MOD + 600)
    );

    expect(Object.keys(unzipSync(new Uint8Array(pinned))).sort()).toEqual([
      'collection.anki2',
      'media',
    ]);
  });

  it('returns the deck untouched when nothing is newer', async () => {
    const original = apkgWithNoteTypeMod(NOTETYPE_MOD);

    expect(await pinSharedNoteTypes(original)).toBe(original);
  });

  it('rejects a file that is not an Anki package', async () => {
    await expect(
      pinSharedNoteTypes(Buffer.from('not a zip'))
    ).rejects.toThrow();
  });
});
