export interface DeckCapabilityNoteType {
  name: string;
  whenToUse: string;
}

export interface DeckCapabilityOption {
  name: string;
  type: string;
  description: string;
}

export interface DeckInputStructure {
  name: string;
  pattern: string;
  example: string;
}

export interface DeckInputNoteType {
  noteType: string;
  options: Record<string, unknown>;
  text: string;
  note?: string;
}

export interface DeckInputFormats {
  howItWorks: string;
  shortcut: string;
  structures: DeckInputStructure[];
  noteTypes: DeckInputNoteType[];
  mcq: string;
}

export interface DeckCapabilities {
  noteTypes: DeckCapabilityNoteType[];
  options: DeckCapabilityOption[];
  inputKinds: string[];
  inputFormats: DeckInputFormats;
  conventions: string[];
}

export const DECK_CAPABILITIES: DeckCapabilities = {
  noteTypes: [
    {
      name: 'basic',
      whenToUse: 'A question on the front, its answer on the back.',
    },
    {
      name: 'basic-reversed',
      whenToUse:
        'Two cards per fact — question to answer and answer to question. Good for vocabulary.',
    },
    {
      name: 'cloze',
      whenToUse:
        'Fill-in-the-blank cards. The text must contain {{c1::hidden term}} markup for a card to become cloze.',
    },
    {
      name: 'input',
      whenToUse:
        'The learner types the answer during review. Good for exact-recall terms and vocabulary.',
    },
    {
      name: 'mcq',
      whenToUse: 'Multiple-choice questions with one correct option.',
    },
  ],
  options: [
    {
      name: 'noteType',
      type: "'basic' | 'basic-reversed' | 'cloze' | 'input' | 'mcq'",
      description:
        'The Anki note type to build. Cloze also needs {{c1::}} markup in the text.',
    },
    {
      name: 'tags',
      type: 'string[]',
      description: 'Anki tags applied to every card in the deck.',
    },
    {
      name: 'deckName',
      type: 'string',
      description:
        'Name the deck. Use :: to nest subdecks, e.g. MS3::Cardiology.',
    },
    {
      name: 'splitByHeadings',
      type: 'boolean',
      description:
        'Turn each heading, toggle, and list on the page into its own subdeck instead of one deck.',
    },
    {
      name: 'styleTemplate',
      type: "'specialstyle' | 'nostyle' | 'abhiyan' | 'alex_deluxe'",
      description:
        'The visual style for the cards. nostyle strips styling; specialstyle is the default look.',
    },
    {
      name: 'tts',
      type: "{ enabled: boolean, language?: string, side?: 'front' | 'back' | 'both' }",
      description:
        'Add text-to-speech playback. Give a language (e.g. ja-JP) for a fixed voice, or leave it off to auto-detect.',
    },
  ],
  inputKinds: [
    'text — Markdown or HTML passed directly',
    'url — a public URL to an HTML, Markdown, CSV, or other supported file',
  ],
  inputFormats: {
    howItWorks:
      'convert_to_deck scans your text for front and back pairs. Pick one structure below to separate each front from its back — you only need one. The note type (basic, basic-reversed, or input) is set through options.noteType and does not change which structure you use. Cloze is the exception: set options.noteType to cloze and put {{c1::...}} markup inside the front of any structure. Without the markup, cloze falls back to basic.',
    shortcut:
      'If you already have discrete front and back pairs, skip the text formatting and call create_deck with a { front, back } array instead. It cannot fail on formatting. create_deck also takes options.noteType (basic, basic-reversed, cloze, or input — not mcq), but only for cards with no deck field; subdeck cards always build as Basic.',
    structures: [
      {
        name: 'inline',
        pattern: 'front :: back — one card per line',
        example: 'What is the powerhouse of the cell? :: Mitochondria',
      },
      {
        name: 'toggle',
        pattern: '<details><summary>front</summary>back</details>',
        example:
          '<details><summary>What is ATP?</summary>The energy currency of the cell</details>',
      },
      {
        name: 'heading',
        pattern: '## front, then the answer on the lines below it',
        example: '## What is ATP?\nThe energy currency of the cell',
      },
      {
        name: 'qa',
        pattern: 'Q: front on one line, A: back on the next',
        example: 'Q: What is ATP?\nA: The energy currency of the cell',
      },
    ],
    noteTypes: [
      {
        noteType: 'basic',
        options: { noteType: 'basic' },
        text: 'Mitochondrion :: The powerhouse of the cell',
      },
      {
        noteType: 'basic-reversed',
        options: { noteType: 'basic-reversed' },
        text: 'Mitochondrion :: The powerhouse of the cell',
        note: 'Same text as basic. Builds two cards per line — front to back and back to front.',
      },
      {
        noteType: 'input',
        options: { noteType: 'input' },
        text: 'Mitochondrion :: The powerhouse of the cell',
        note: 'Same text as basic. The learner types the answer during review.',
      },
      {
        noteType: 'cloze',
        options: { noteType: 'cloze' },
        text: 'The {{c1::mitochondrion}} is the powerhouse of the cell :: Found in eukaryotic cells',
        note: 'Cloze needs {{c1::...}} markup in the front of the card. Without the markup, cloze falls back to basic.',
      },
    ],
    mcq: 'Multiple-choice cards are built from Notion toggle-list exports that mark the correct option, not from free-form text or structured cards. To make them, convert a Notion export with options.noteType set to mcq. create_deck does not support mcq.',
  },
  conventions: [
    'Cloze cards require {{c1::...}} markup in the text; without it, cloze falls back to basic.',
    'Deck names use :: to nest subdecks, e.g. Spanish::Verbs::Irregular.',
    'create_deck sorts cards into subdecks with a per-card deck field: a leaf name relative to deckName. deck "Vocabulary" under deckName "JLPT N5" lands in JLPT N5::Vocabulary; use :: in deck to nest deeper (Verbs::Irregular); omit deck to keep the card in deckName.',
    'Only these curated options are honored; unknown keys are ignored and never bypass account limits.',
  ],
};
