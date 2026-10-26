import { VIEWER_HELPERS_JS } from './deckViewerScript';

interface ViewerState {
  view: string;
  titlePath?: string[];
  cardCount?: number;
  noteCount?: number | null;
  noteTypes?: string[];
  tts?: boolean;
  cards?: { front: string; back: string }[];
  tree?: unknown[];
  page?: number;
  pageSize?: number;
  index?: number;
  identifier?: Record<string, string> | null;
  downloadUrl?: string | null;
  message?: string;
  decks?: unknown[];
}

interface Helpers {
  noteTypeLabel: (name: string) => string;
  deckTitlePath: (decks: { name: string }[], fallback?: string) => string[];
  buildDeckTree: (decks: { name: string; cardCount: number }[]) => unknown[];
  splitSoundTokens: (text: string) => unknown[];
  summaryLine: (state: Partial<ViewerState>) => string;
  readToolResult: (
    result: Record<string, unknown>,
    args?: Record<string, unknown> | null
  ) => ViewerState;
  hasNext: (state: ViewerState) => boolean;
  hasPrev: (state: ViewerState) => boolean;
}

// The helpers ship as a constant string of browser JS; evaluating that same
// constant is the only way to test the code the iframe runs.
const helpers = new Function(
  `${VIEWER_HELPERS_JS}
  return { noteTypeLabel, deckTitlePath, buildDeckTree, splitSoundTokens,
    summaryLine, readToolResult, hasNext, hasPrev };`
)() as Helpers;

describe('deck viewer helpers', () => {
  it('labels 2anki note types and passes other names through', () => {
    expect(helpers.noteTypeLabel('n2a-cloze')).toBe('Cloze');
    expect(helpers.noteTypeLabel('n2a-basic-reversed')).toBe(
      'Basic and reversed'
    );
    expect(helpers.noteTypeLabel('Japanese (recognition)')).toBe(
      'Japanese (recognition)'
    );
  });

  it('titles a deck by the path its subdecks share', () => {
    expect(
      helpers.deckTitlePath([
        { name: 'Pharmacology::Cardiovascular::Beta blockers' },
      ])
    ).toEqual(['Pharmacology', 'Cardiovascular', 'Beta blockers']);
    expect(
      helpers.deckTitlePath([
        { name: 'JLPT N5::Grammar' },
        { name: 'JLPT N5::Vocabulary' },
      ])
    ).toEqual(['JLPT N5']);
    expect(
      helpers.deckTitlePath([{ name: 'A' }, { name: 'B' }], 'Notes.apkg')
    ).toEqual(['Notes']);
  });

  it('builds a subdeck tree below the shared path with rolled-up counts', () => {
    expect(
      helpers.buildDeckTree([
        { name: 'N5::Grammar', cardCount: 4 },
        { name: 'N5::Vocab::Verbs', cardCount: 3 },
        { name: 'N5::Vocab::Nouns', cardCount: 2 },
      ])
    ).toEqual([
      { name: 'Grammar', count: 4, children: [] },
      {
        name: 'Vocab',
        count: 5,
        children: [
          { name: 'Verbs', count: 3, children: [] },
          { name: 'Nouns', count: 2, children: [] },
        ],
      },
    ]);
    expect(helpers.buildDeckTree([{ name: 'Solo', cardCount: 3 }])).toEqual([]);
  });

  it('splits Anki sound tags out of text', () => {
    expect(helpers.splitSoundTokens('hi [sound:a.mp3] there')).toEqual([
      { text: 'hi ' },
      { sound: true },
      { text: ' there' },
    ]);
  });

  it('writes the summary line with numerals and no fanfare', () => {
    expect(
      helpers.summaryLine({
        noteCount: 54,
        noteTypes: ['n2a-cloze'],
        tts: true,
      })
    ).toBe('from 54 notes · Cloze · Text to speech');
    expect(helpers.summaryLine({ noteCount: 1, noteTypes: [] })).toBe(
      'from 1 note'
    );
  });

  it('reads a get_deck_preview result with the page from the tool input', () => {
    const state = helpers.readToolResult(
      {
        structuredContent: {
          cardCount: 98,
          deckCount: 1,
          decks: [{ name: 'Pharm::Beta blockers', cardCount: 98 }],
          sampleCards: [
            { front: 'q1', back: 'a1' },
            { front: 'q2', back: 'a2' },
          ],
          noteCount: 54,
          noteTypes: ['n2a-cloze'],
          downloadUrl: 'https://2anki.net/x',
        },
      },
      { jobId: 'job-1', page: 2, pageSize: 2 }
    );
    expect(state).toMatchObject({
      view: 'deck',
      titlePath: ['Pharm', 'Beta blockers'],
      cardCount: 98,
      noteCount: 54,
      page: 2,
      pageSize: 2,
      identifier: { jobId: 'job-1' },
      downloadUrl: 'https://2anki.net/x',
    });
    expect(helpers.hasNext(state)).toBe(true);
    expect(helpers.hasPrev(state)).toBe(true);
  });

  it('keeps page 0 of a create_deck result in deck order', () => {
    const sampleCards = Array.from({ length: 21 }, (_, i) => ({
      front: `f${i}`,
      back: `b${i}`,
    }));
    const state = helpers.readToolResult({
      structuredContent: {
        kind: 'deck',
        jobId: 'job-9',
        cardCount: 40,
        filename: 'Bio.apkg',
        sampleCards,
      },
    });
    expect(state.cards).toHaveLength(20);
    expect(state.page).toBe(0);
    expect(state.identifier).toEqual({ jobId: 'job-9' });
    expect(state.titlePath).toEqual(['Bio']);
  });

  it('stops paging at the last card and without an identifier', () => {
    const last = helpers.readToolResult(
      {
        structuredContent: {
          cardCount: 3,
          sampleCards: [{ front: 'q', back: 'a' }],
        },
      },
      { key: 'deck.apkg', page: 2, pageSize: 1 }
    );
    expect(helpers.hasNext(last)).toBe(false);
    const anonymous = helpers.readToolResult({
      structuredContent: {
        cardCount: 30,
        sampleCards: [{ front: 'q', back: 'a' }],
      },
    });
    expect(helpers.hasNext(anonymous)).toBe(false);
  });

  it('reads errors, queued jobs and batches', () => {
    expect(
      helpers.readToolResult({
        isError: true,
        content: [{ type: 'text', text: 'Deck not found.' }],
        structuredContent: {
          code: 'preview_failed',
          message: 'Deck not found.',
        },
      })
    ).toEqual({ view: 'error', message: 'Deck not found.' });
    expect(
      helpers.readToolResult({
        structuredContent: { kind: 'processing', jobId: 'j' },
      }).view
    ).toBe('processing');
    expect(
      helpers.readToolResult({
        structuredContent: {
          kind: 'batch',
          decks: [{ name: 'A', downloadUrl: 'https://2anki.net/a' }],
        },
      }).decks
    ).toHaveLength(1);
  });
});
