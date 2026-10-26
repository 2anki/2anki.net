import type { ParsedApkg } from '../ApkgPreviewService/ApkgPreviewService';
import type { NoteType } from '../ApkgPreviewService/types';
import { cardTags, deckFacts } from './deckViewerFields';

function noteType(id: number, name: string, qfmt = '{{Front}}'): NoteType {
  return {
    id,
    name,
    type: name.includes('cloze') ? 1 : 0,
    css: '',
    fields: [],
    templates: [{ name: 'Card 1', ord: 0, qfmt, afmt: '{{Back}}' }],
  };
}

function parsedWith(
  noteTypes: NoteType[],
  notes: { id: number; mid: number; tags: string }[],
  cards: { id: number; nid: number }[]
): ParsedApkg {
  return {
    collection: {
      noteTypes: new Map(noteTypes.map((type) => [type.id, type])),
      notes: new Map(
        notes.map((note) => [note.id, { ...note, fields: ['', ''] }])
      ),
      decks: new Map(),
      cards: cards.map((card) => ({ ...card, did: 1, ord: 0 })),
    },
    mediaMap: new Map(),
    mediaEntries: new Map(),
    parsedAt: 0,
  };
}

describe('deckFacts', () => {
  it('counts distinct notes and lists note types by usage', () => {
    const parsed = parsedWith(
      [noteType(1, 'n2a-basic'), noteType(2, 'n2a-cloze')],
      [
        { id: 10, mid: 2, tags: '' },
        { id: 11, mid: 2, tags: '' },
        { id: 12, mid: 1, tags: '' },
      ],
      [
        { id: 1, nid: 10 },
        { id: 2, nid: 10 },
        { id: 3, nid: 11 },
        { id: 4, nid: 12 },
      ]
    );
    expect(deckFacts(parsed)).toEqual({
      noteCount: 3,
      noteTypes: ['n2a-cloze', 'n2a-basic'],
    });
  });

  it('flags text to speech when a used template has a tts field', () => {
    const parsed = parsedWith(
      [noteType(1, 'n2a-basic', '{{tts ja_JP:Front}}')],
      [{ id: 10, mid: 1, tags: '' }],
      [{ id: 1, nid: 10 }]
    );
    expect(deckFacts(parsed).tts).toBe(true);
  });

  it('returns no facts for a parse without a collection', () => {
    expect(deckFacts({} as ParsedApkg)).toEqual({});
  });
});

describe('cardTags', () => {
  it("splits the card's note tags on whitespace", () => {
    const parsed = parsedWith(
      [noteType(1, 'n2a-basic')],
      [{ id: 10, mid: 1, tags: ' pharm  cardio::beta ' }],
      [{ id: 1, nid: 10 }]
    );
    expect(cardTags(parsed, 1)).toEqual(['pharm', 'cardio::beta']);
    expect(cardTags(parsed, 99)).toEqual([]);
  });
});
