import { strToU8, zipSync } from 'fflate';
import { strFromU8, unzipSync } from 'fflate';

import {
  DeckUploadError,
  LEGACY_STUB_COLLECTION_MESSAGE,
  NOT_A_COLLECTION_MESSAGE,
  resolveDeckUpload,
  UNREADABLE_ZIP_MESSAGE,
} from './resolveDeckUpload';

function zip(entries: Record<string, Uint8Array | string>): Buffer {
  const files: Record<string, Uint8Array> = {};
  for (const [name, body] of Object.entries(entries)) {
    files[name] = typeof body === 'string' ? strToU8(body) : body;
  }
  return Buffer.from(zipSync(files));
}

const APKG = zip({ 'collection.anki2': 'sqlite', media: '{}', '0': 'img' });

describe('resolveDeckUpload', () => {
  it('passes an .apkg straight through', async () => {
    expect(await resolveDeckUpload(APKG, 'Biology.apkg')).toEqual({
      kind: 'deck',
      deck: APKG,
      deckName: 'Biology',
      shape: 'apkg',
    });
  });

  it('passes a .colpkg collection export straight through', async () => {
    expect(await resolveDeckUpload(APKG, 'Profile.colpkg')).toEqual({
      kind: 'deck',
      deck: APKG,
      deckName: 'Profile',
      shape: 'colpkg',
    });
  });

  it.each([
    ['collection.anki21b', '\u0028\u00b5\u002f\u00fd zstd frame'],
    ['collection.anki21', 'SQLite format 3\u0000 real notes'],
    ['collection.anki2', 'SQLite format 3\u0000 real notes'],
  ])(
    'packs a bare %s, taken out of a deck folder, back into a deck',
    async (name, body) => {
      const collection = Buffer.from(body, 'latin1');

      const result = await resolveDeckUpload(collection, name);

      expect(result).toMatchObject({
        kind: 'deck',
        deckName: 'collection',
        shape: 'collection_file',
      });
      const entries =
        result.kind === 'deck' ? unzipSync(new Uint8Array(result.deck)) : {};
      expect(Object.keys(entries).sort()).toEqual([name, 'media'].sort());
      expect(Buffer.from(entries[name]).equals(collection)).toBe(true);
      expect(strFromU8(entries.media)).toBe('{}');
    }
  );

  it('explains the placeholder collection.anki2 instead of printing it', async () => {
    const stub = Buffer.from(
      'SQLite format 3\u0000 Please update to the latest Anki version, then import the .colpkg/.apkg file again.'
    );

    const error = await resolveDeckUpload(stub, 'collection.anki2').catch(
      (e: unknown) => e
    );

    expect(error).toBeInstanceOf(DeckUploadError);
    expect((error as Error).message).toBe(LEGACY_STUB_COLLECTION_MESSAGE);
  });

  it.each(['collection.anki2', 'collection.anki21b'])(
    'refuses a %s that is not a collection with a clear message',
    async (name) => {
      const error = await resolveDeckUpload(
        Buffer.from('just some notes'),
        name
      ).catch((e: unknown) => e);

      expect(error).toBeInstanceOf(DeckUploadError);
      expect((error as Error).message).toBe(NOT_A_COLLECTION_MESSAGE);
    }
  );

  it('takes a .colpkg out of a zip like an .apkg', async () => {
    const upload = zip({ 'backup/Profile.colpkg': APKG });
    expect(await resolveDeckUpload(upload, 'backup.zip')).toMatchObject({
      kind: 'deck',
      deckName: 'Profile',
      shape: 'zip_one_deck',
    });
  });

  it('opens an .apkg that was saved with a .zip name', async () => {
    expect(await resolveDeckUpload(APKG, 'Biology.zip')).toMatchObject({
      kind: 'deck',
      deck: APKG,
      deckName: 'Biology',
      shape: 'zip_is_deck',
    });
  });

  it('takes the deck out of a zip that holds one deck beside other files', async () => {
    const upload = zip({
      'notes/readme.txt': 'hi',
      'export/Chemistry.apkg': APKG,
      '__MACOSX/export/._Chemistry.apkg': 'resource fork',
    });

    const result = await resolveDeckUpload(upload, 'download.zip');

    expect(result).toMatchObject({
      kind: 'deck',
      deckName: 'Chemistry',
      shape: 'zip_one_deck',
    });
    expect(result.kind === 'deck' && result.deck.equals(APKG)).toBe(true);
  });

  it('asks which deck to use when the zip holds several', async () => {
    const upload = zip({ 'a/One.apkg': APKG, 'b/Two.apkg': APKG });
    expect(await resolveDeckUpload(upload, 'decks.zip')).toEqual({
      kind: 'choose',
      decks: ['a/One.apkg', 'b/Two.apkg'],
    });
  });

  it('opens the deck the person picked from several', async () => {
    const upload = zip({ 'a/One.apkg': 'other', 'b/Two.apkg': APKG });
    const result = await resolveDeckUpload(upload, 'decks.zip', 'b/Two.apkg');
    expect(result).toMatchObject({ kind: 'deck', deckName: 'Two' });
    expect(result.kind === 'deck' && result.deck.equals(APKG)).toBe(true);
  });

  it('ignores a picked name that is not one of the decks in the zip', async () => {
    const upload = zip({ 'a/One.apkg': APKG, 'b/Two.apkg': APKG });
    expect(
      await resolveDeckUpload(upload, 'decks.zip', '../etc/passwd')
    ).toEqual({
      kind: 'choose',
      decks: ['a/One.apkg', 'b/Two.apkg'],
    });
  });

  it.each([
    ['a zip of notes', zip({ 'notes.md': '# notes' }), 'archive.zip'],
    ['a file that is not a zip or deck', Buffer.from('x'), 'notes.pdf'],
  ])(
    'routes %s to deck making instead of refusing',
    async (_label, upload, name) => {
      expect(await resolveDeckUpload(upload, name)).toEqual({
        kind: 'not_a_deck',
      });
    }
  );

  it('refuses a zip whose entry path climbs out of the archive', async () => {
    await expect(
      resolveDeckUpload(zip({ '../escape.apkg': 'x' }), 'evil.zip')
    ).rejects.toBeInstanceOf(DeckUploadError);
  });

  it('explains a zip that cannot be opened', async () => {
    const broken = resolveDeckUpload(Buffer.from('nope'), 'broken.zip');
    await expect(broken).rejects.toBeInstanceOf(DeckUploadError);
    await expect(broken).rejects.toThrow(UNREADABLE_ZIP_MESSAGE);
  });

  it('refuses a tiny zip that claims billions of entries, quickly', async () => {
    const bomb = Buffer.alloc(98);
    bomb.writeUInt32LE(0x06064b50, 0);
    bomb.writeUInt32LE(0xffffffff, 32);
    bomb.writeUInt32LE(0, 48);
    bomb.writeUInt32LE(0x07064b50, 56);
    bomb.writeUInt32LE(0, 64);
    bomb.writeUInt32LE(0x06054b50, 76);
    bomb.writeUInt16LE(0xffff, 84);

    const started = Date.now();
    await expect(resolveDeckUpload(bomb, 'x.zip')).rejects.toThrow(
      UNREADABLE_ZIP_MESSAGE
    );
    expect(Date.now() - started).toBeLessThan(2000);
  });

  it('inflates a deck listed many times over only once', async () => {
    const single = zipSync({ 'a.apkg': APKG });
    const view = Buffer.from(single);
    const eocd = view.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
    const cdOffset = view.readUInt32LE(eocd + 16);
    const cdSize = view.readUInt32LE(eocd + 12);
    const entry = view.subarray(cdOffset, cdOffset + cdSize);
    const copies = 50;
    const directory = Buffer.concat(
      Array.from({ length: copies }, () => entry)
    );
    const end = Buffer.from(view.subarray(eocd));
    end.writeUInt16LE(copies, 8);
    end.writeUInt16LE(copies, 10);
    end.writeUInt32LE(directory.length, 12);
    end.writeUInt32LE(cdOffset, 16);
    const repeated = Buffer.concat([
      view.subarray(0, cdOffset),
      directory,
      end,
    ]);

    const result = await resolveDeckUpload(repeated, 'dup.zip');

    expect(result).toMatchObject({ kind: 'deck', deckName: 'a' });
    expect(result.kind === 'deck' && result.deck.equals(APKG)).toBe(true);
  });

  it('names a deck saved as .apkg.zip without either extension', async () => {
    expect(await resolveDeckUpload(APKG, 'Biology.apkg.zip')).toMatchObject({
      deckName: 'Biology',
    });
  });

  function withEntryHeader(
    entryName: string,
    patch: (view: Buffer, central: number, local: number) => void
  ): Buffer {
    const view = Buffer.from(
      zipSync({ [entryName]: strToU8('deck bytes '.repeat(50)) })
    );
    const central = view.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
    patch(view, central, 0);
    return view;
  }

  it('refuses an inner deck whose header claims more data than the upload holds', async () => {
    const lying = withEntryHeader('a.apkg', (view, central) => {
      view.writeUInt32LE(2_000_000, central + 20);
      view.writeUInt32LE(100 * 1024 * 1024, central + 24);
    });
    await expect(resolveDeckUpload(lying, 'lie.zip')).rejects.toBeInstanceOf(
      DeckUploadError
    );
  });

  it('explains a deck inside the zip whose data is corrupt', async () => {
    const corrupt = withEntryHeader('a.apkg', (view, central) => {
      const local = view.readUInt32LE(central + 42);
      const nameLength = view.readUInt16LE(local + 26);
      const extra = view.readUInt16LE(local + 28);
      const data = local + 30 + nameLength + extra;
      view.fill(0xff, data, data + 8);
      view.writeUInt16LE(8, central + 10);
    });
    await expect(
      resolveDeckUpload(corrupt, 'corrupt.zip')
    ).rejects.toBeInstanceOf(DeckUploadError);
  });

  it('stops inflating a deck whose real size is larger than its header says', async () => {
    const big = Buffer.alloc(5 * 1024 * 1024, 0x61);
    const view = Buffer.from(zipSync({ 'a.apkg': new Uint8Array(big) }));
    const central = view.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
    const compressed = view.readUInt32LE(central + 20);
    view.writeUInt32LE(compressed * 2, central + 24);

    const started = Date.now();
    await expect(resolveDeckUpload(view, 'bomb.zip')).rejects.toBeInstanceOf(
      DeckUploadError
    );
    expect(Date.now() - started).toBeLessThan(2000);
  });

  it('keeps the deck list short and ignores absurdly long names', async () => {
    const entries: Record<string, Uint8Array> = {};
    for (let i = 0; i < 80; i += 1) entries[`deck-${i}.apkg`] = APKG;
    entries[`${'x'.repeat(600)}.apkg`] = APKG;

    const result = await resolveDeckUpload(zip(entries), 'many.zip');

    expect(result.kind).toBe('choose');
    if (result.kind !== 'choose') return;
    expect(result.decks).toHaveLength(50);
    expect(result.decks.every((deck) => deck.length < 600)).toBe(true);
  });
});
