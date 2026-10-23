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
});
