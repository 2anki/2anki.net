import { vi, type Mock } from 'vitest';
import { parseApkgNotes } from './parseApkgNotes';
import { NormalizedCollection, Note, NoteType, Deck, Card } from './types';
import { parseCollection as parseCollectionActual } from './parseCollection';
import {
  extractApkg as extractApkgActual,
  parseMediaManifest as parseMediaManifestActual,
} from './extractApkg';

vi.mock('./extractApkg', () => ({
  extractApkg: vi.fn().mockResolvedValue({
    collectionBuffer: Buffer.from('stub'),
    mediaManifestRaw: null,
    mediaEntries: new Map(),
  }),
  parseMediaManifest: vi.fn(() => new Map()),
}));

vi.mock('./parseCollection', () => ({
  parseCollection: vi.fn(),
}));

const parseCollection = parseCollectionActual as unknown as Mock;
const extractApkg = extractApkgActual as unknown as Mock;
const parseMediaManifest = parseMediaManifestActual as unknown as Mock;

const noteType = (overrides: Partial<NoteType> = {}): NoteType => ({
  id: 1,
  name: 'Basic',
  type: 0,
  css: '',
  fields: [],
  templates: [],
  ...overrides,
});

const note = (overrides: Partial<Note> = {}): Note => ({
  id: 100,
  mid: 1,
  tags: '',
  fields: ['front', 'back'],
  guid: 'guid-100',
  ...overrides,
});

const buildCollection = (parts: {
  noteTypes?: NoteType[];
  notes?: Note[];
  decks?: Deck[];
  cards?: Card[];
}): NormalizedCollection => ({
  noteTypes: new Map((parts.noteTypes ?? []).map((nt) => [nt.id, nt])),
  notes: new Map((parts.notes ?? []).map((n) => [n.id, n])),
  decks: new Map((parts.decks ?? []).map((d) => [d.id, d])),
  cards: parts.cards ?? [],
});

const stubCollection = (collection: NormalizedCollection) => {
  parseCollection.mockReturnValue(collection);
};

beforeEach(() => {
  parseCollection.mockReset();
});

describe('parseApkgNotes', () => {
  it('returns empty notes and the fallback deck name when the collection is empty', async () => {
    stubCollection(buildCollection({}));

    const result = await parseApkgNotes(Buffer.alloc(0));

    expect(result).toEqual({
      notes: [],
      unknownModelNames: [],
      deckName: 'Transformed deck',
      sourceMedia: [],
    });
  });

  it('extracts a Basic note with front, back, tags, and guid', async () => {
    stubCollection(
      buildCollection({
        noteTypes: [noteType({ id: 1, name: 'Basic', type: 0 })],
        notes: [
          note({
            id: 100,
            mid: 1,
            fields: ['Q', 'A'],
            tags: ' alpha  beta ',
            guid: 'g-1',
          }),
        ],
        decks: [{ id: 9, name: 'Deck A' }],
        cards: [{ id: 1, nid: 100, did: 9, ord: 0 }],
      })
    );

    const result = await parseApkgNotes(Buffer.alloc(0));

    expect(result.notes).toEqual([
      {
        guid: 'g-1',
        modelKind: 'basic',
        modelName: 'Basic',
        fields: ['Q', 'A'],
        fieldNames: [],
        frontFieldIndex: 0,
        backFieldIndex: 1,
        tags: ['alpha', 'beta'],
      },
    ]);
    expect(result.deckName).toBe('Deck A');
    expect(result.unknownModelNames).toEqual([]);
  });

  it('classifies a note as cloze when the model type flag is 1', async () => {
    stubCollection(
      buildCollection({
        noteTypes: [noteType({ id: 2, name: 'My Cloze Style', type: 1 })],
        notes: [note({ id: 200, mid: 2, fields: ['front {{c1::word}}', ''] })],
      })
    );

    const result = await parseApkgNotes(Buffer.alloc(0));

    expect(result.notes[0]?.modelKind).toBe('cloze');
  });

  it('classifies a note as cloze when the model name contains "cloze" even with type flag 0', async () => {
    stubCollection(
      buildCollection({
        noteTypes: [noteType({ id: 3, name: 'Cloze (Custom)', type: 0 })],
        notes: [note({ id: 300, mid: 3, fields: ['front', 'back'] })],
      })
    );

    const result = await parseApkgNotes(Buffer.alloc(0));

    expect(result.notes[0]?.modelKind).toBe('cloze');
  });

  it('picks the deck name from the deck holding the most cards', async () => {
    stubCollection(
      buildCollection({
        noteTypes: [noteType({ id: 1 })],
        notes: [note({ id: 100 }), note({ id: 101 })],
        decks: [
          { id: 9, name: 'Minority deck' },
          { id: 10, name: 'Majority deck' },
        ],
        cards: [
          { id: 1, nid: 100, did: 9, ord: 0 },
          { id: 2, nid: 101, did: 10, ord: 0 },
          { id: 3, nid: 101, did: 10, ord: 1 },
        ],
      })
    );

    const result = await parseApkgNotes(Buffer.alloc(0));

    expect(result.deckName).toBe('Majority deck');
  });

  it('falls back to "Transformed deck" when the majority deck id is not in the deck map', async () => {
    stubCollection(
      buildCollection({
        noteTypes: [noteType({ id: 1 })],
        notes: [note({ id: 100 })],
        cards: [{ id: 1, nid: 100, did: 999, ord: 0 }],
      })
    );

    const result = await parseApkgNotes(Buffer.alloc(0));

    expect(result.deckName).toBe('Transformed deck');
  });

  it('skips a note whose model is missing from the collection', async () => {
    stubCollection(
      buildCollection({
        notes: [note({ id: 100, mid: 1 })],
      })
    );

    const result = await parseApkgNotes(Buffer.alloc(0));

    expect(result.notes).toEqual([]);
  });

  it('skips a note with an empty fields array', async () => {
    stubCollection(
      buildCollection({
        noteTypes: [noteType({ id: 1 })],
        notes: [note({ id: 100, fields: [] })],
      })
    );

    const result = await parseApkgNotes(Buffer.alloc(0));

    expect(result.notes).toEqual([]);
  });

  it('falls back to an id-prefixed guid when the note has no guid', async () => {
    stubCollection(
      buildCollection({
        noteTypes: [noteType({ id: 1 })],
        notes: [note({ id: 555, guid: undefined })],
      })
    );

    const result = await parseApkgNotes(Buffer.alloc(0));

    expect(result.notes[0]?.guid).toBe('id-555');
  });

  it('derives front and back field indices from the note type template', async () => {
    stubCollection(
      buildCollection({
        noteTypes: [
          noteType({
            id: 7,
            name: 'Vocabulary Basic',
            type: 0,
            fields: [
              { name: 'Word', ord: 0 },
              { name: 'Pronunciation', ord: 1 },
              { name: 'Meaning', ord: 2 },
            ],
            templates: [
              {
                name: 'Card 1',
                ord: 0,
                qfmt: '{{Word}}',
                afmt: '{{FrontSide}}<hr id="answer">{{Meaning}}',
              },
            ],
          }),
        ],
        notes: [
          note({ id: 700, mid: 7, fields: ['der Hund', '[hʊnt]', 'the dog'] }),
        ],
      })
    );

    const result = await parseApkgNotes(Buffer.alloc(0));

    expect(result.notes[0]).toMatchObject({
      fields: ['der Hund', '[hʊnt]', 'the dog'],
      fieldNames: ['Word', 'Pronunciation', 'Meaning'],
      frontFieldIndex: 0,
      backFieldIndex: 2,
    });
  });

  it('falls back to indices 0 and 1 when the model has no templates', async () => {
    stubCollection(
      buildCollection({
        noteTypes: [noteType({ id: 1 })],
        notes: [note({ id: 100 })],
      })
    );

    const result = await parseApkgNotes(Buffer.alloc(0));

    expect(result.notes[0]).toMatchObject({
      frontFieldIndex: 0,
      backFieldIndex: 1,
    });
  });

  it('treats a missing back field as empty string', async () => {
    stubCollection(
      buildCollection({
        noteTypes: [noteType({ id: 1 })],
        notes: [note({ id: 100, fields: ['only-front'] })],
      })
    );

    const result = await parseApkgNotes(Buffer.alloc(0));

    expect(result.notes[0]).toEqual(
      expect.objectContaining({ fields: ['only-front'] })
    );
  });
});

describe('parseApkgNotes source media sanitization', () => {
  afterEach(() => {
    extractApkg.mockResolvedValue({
      collectionBuffer: Buffer.from('stub'),
      mediaManifestRaw: null,
      mediaEntries: new Map(),
    });
    parseMediaManifest.mockReturnValue(new Map());
  });

  it('strips path segments from a traversal media name to its basename', async () => {
    stubCollection(buildCollection({}));
    extractApkg.mockResolvedValue({
      collectionBuffer: Buffer.from('stub'),
      mediaManifestRaw: Buffer.from('stub'),
      mediaEntries: new Map([['0', Buffer.from('payload')]]),
    });
    parseMediaManifest.mockReturnValue(
      new Map([['../../../dist/escape.js', '0']])
    );

    const result = await parseApkgNotes(Buffer.alloc(0));

    expect(result.sourceMedia).toEqual([
      { filename: 'escape.js', bytes: Buffer.from('payload') },
    ]);
  });

  it('keeps a normal media filename intact', async () => {
    stubCollection(buildCollection({}));
    extractApkg.mockResolvedValue({
      collectionBuffer: Buffer.from('stub'),
      mediaManifestRaw: Buffer.from('stub'),
      mediaEntries: new Map([['0', Buffer.from('img')]]),
    });
    parseMediaManifest.mockReturnValue(new Map([['2anki-abcdef.png', '0']]));

    const result = await parseApkgNotes(Buffer.alloc(0));

    expect(result.sourceMedia).toEqual([
      { filename: '2anki-abcdef.png', bytes: Buffer.from('img') },
    ]);
  });

  it('drops a media entry whose name is only path separators', async () => {
    stubCollection(buildCollection({}));
    extractApkg.mockResolvedValue({
      collectionBuffer: Buffer.from('stub'),
      mediaManifestRaw: Buffer.from('stub'),
      mediaEntries: new Map([['0', Buffer.from('payload')]]),
    });
    parseMediaManifest.mockReturnValue(new Map([['/', '0']]));

    const result = await parseApkgNotes(Buffer.alloc(0));

    expect(result.sourceMedia).toEqual([]);
  });
});
