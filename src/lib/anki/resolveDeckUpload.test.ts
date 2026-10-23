import { strToU8, zipSync } from 'fflate';

import {
  DeckUploadError,
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
  it('passes an .apkg straight through', () => {
    expect(resolveDeckUpload(APKG, 'Biology.apkg')).toEqual({
      kind: 'deck',
      deck: APKG,
      deckName: 'Biology',
      shape: 'apkg',
    });
  });

  it('opens an .apkg that was saved with a .zip name', () => {
    expect(resolveDeckUpload(APKG, 'Biology.zip')).toMatchObject({
      kind: 'deck',
      deck: APKG,
      deckName: 'Biology',
      shape: 'zip_is_deck',
    });
  });

  it('takes the deck out of a zip that holds one deck beside other files', () => {
    const upload = zip({
      'notes/readme.txt': 'hi',
      'export/Chemistry.apkg': APKG,
      '__MACOSX/export/._Chemistry.apkg': 'resource fork',
    });

    const result = resolveDeckUpload(upload, 'download.zip');

    expect(result).toMatchObject({
      kind: 'deck',
      deckName: 'Chemistry',
      shape: 'zip_one_deck',
    });
    expect(result.kind === 'deck' && result.deck.equals(APKG)).toBe(true);
  });

  it('asks which deck to use when the zip holds several', () => {
    const upload = zip({ 'a/One.apkg': APKG, 'b/Two.apkg': APKG });
    expect(resolveDeckUpload(upload, 'decks.zip')).toEqual({
      kind: 'choose',
      decks: ['a/One.apkg', 'b/Two.apkg'],
    });
  });

  it('opens the deck the person picked from several', () => {
    const upload = zip({ 'a/One.apkg': 'other', 'b/Two.apkg': APKG });
    const result = resolveDeckUpload(upload, 'decks.zip', 'b/Two.apkg');
    expect(result).toMatchObject({ kind: 'deck', deckName: 'Two' });
    expect(result.kind === 'deck' && result.deck.equals(APKG)).toBe(true);
  });

  it('ignores a picked name that is not one of the decks in the zip', () => {
    const upload = zip({ 'a/One.apkg': APKG, 'b/Two.apkg': APKG });
    expect(resolveDeckUpload(upload, 'decks.zip', '../etc/passwd')).toEqual({
      kind: 'choose',
      decks: ['a/One.apkg', 'b/Two.apkg'],
    });
  });

  it.each([
    ['a zip of notes', zip({ 'notes.md': '# notes' }), 'archive.zip'],
    ['a file that is not a zip or deck', Buffer.from('x'), 'notes.pdf'],
    [
      'a zip whose only deck path climbs out',
      zip({ '../escape.apkg': 'x' }),
      'evil.zip',
    ],
  ])('routes %s to deck making instead of refusing', (_label, upload, name) => {
    expect(resolveDeckUpload(upload, name)).toEqual({ kind: 'not_a_deck' });
  });

  it('explains a zip that cannot be opened', () => {
    const broken = () => resolveDeckUpload(Buffer.from('nope'), 'broken.zip');
    expect(broken).toThrow(DeckUploadError);
    expect(broken).toThrow(UNREADABLE_ZIP_MESSAGE);
  });

  it('refuses a tiny zip that claims billions of entries, quickly', () => {
    const bomb = Buffer.alloc(98);
    bomb.writeUInt32LE(0x06064b50, 0);
    bomb.writeUInt32LE(0xffffffff, 32);
    bomb.writeUInt32LE(0, 48);
    bomb.writeUInt32LE(0x07064b50, 56);
    bomb.writeUInt32LE(0, 64);
    bomb.writeUInt32LE(0x06054b50, 76);
    bomb.writeUInt16LE(0xffff, 84);

    const started = Date.now();
    expect(() => resolveDeckUpload(bomb, 'x.zip')).toThrow(
      UNREADABLE_ZIP_MESSAGE
    );
    expect(Date.now() - started).toBeLessThan(2000);
  });

  it('inflates a deck listed many times over only once', () => {
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

    const result = resolveDeckUpload(repeated, 'dup.zip');

    expect(result).toMatchObject({ kind: 'deck', deckName: 'a' });
    expect(result.kind === 'deck' && result.deck.equals(APKG)).toBe(true);
  });

  it('names a deck saved as .apkg.zip without either extension', () => {
    expect(resolveDeckUpload(APKG, 'Biology.apkg.zip')).toMatchObject({
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

  it('refuses an inner deck whose header claims more data than the upload holds', () => {
    const lying = withEntryHeader('a.apkg', (view, central) => {
      view.writeUInt32LE(2_000_000, central + 20);
      view.writeUInt32LE(100 * 1024 * 1024, central + 24);
    });
    expect(() => resolveDeckUpload(lying, 'lie.zip')).toThrow(DeckUploadError);
  });

  it('explains a deck inside the zip whose data is corrupt', () => {
    const corrupt = withEntryHeader('a.apkg', (view, central) => {
      const local = view.readUInt32LE(central + 42);
      const nameLength = view.readUInt16LE(local + 26);
      const extra = view.readUInt16LE(local + 28);
      const data = local + 30 + nameLength + extra;
      view.fill(0xff, data, data + 8);
      view.writeUInt16LE(8, central + 10);
    });
    expect(() => resolveDeckUpload(corrupt, 'corrupt.zip')).toThrow(
      DeckUploadError
    );
  });
});
