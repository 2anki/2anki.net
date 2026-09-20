import ApkgPreviewService from './ApkgPreviewService';
import { NormalizedCollection } from './types';

const IO_TEMPLATE_QFMT =
  '<div id="image-occlusion-container">{{Image}}<canvas id="image-occlusion-canvas"></canvas></div><script>anki.imageOcclusion.setup();</script>';

function makeIoCollection(): NormalizedCollection {
  const noteType = {
    id: 1,
    name: 'Image Occlusion',
    type: 0 as const,
    css: '.card { font-family: arial; }',
    fields: [
      { name: 'Occlusion', ord: 0 },
      { name: 'Image', ord: 1 },
      { name: 'Header', ord: 2 },
    ],
    templates: [
      {
        name: 'Image Occlusion',
        ord: 0,
        qfmt: IO_TEMPLATE_QFMT,
        afmt: IO_TEMPLATE_QFMT,
      },
    ],
  };

  const note = {
    id: 10,
    mid: 1,
    tags: '',
    fields: [
      'rect:left=0.1:top=0.2:width=0.3:height=0.4:oi=1',
      '<img src="study.png">',
      'Chapter 1',
    ],
  };

  return {
    noteTypes: new Map([[1, noteType]]),
    notes: new Map([[10, note]]),
    decks: new Map([[2, { id: 2, name: 'Biology' }]]),
    cards: [{ id: 100, nid: 10, did: 2, ord: 0 }],
  };
}

const MCQ_TEMPLATE_QFMT =
  '<div class="front">{{Question}}<form id="shuffle"></form></div><script>buildOptions();</script>';
const MCQ_TEMPLATE_AFMT =
  '<div class="back">{{Question}}<form id="shuffle"></form>{{#Extra}}<div>{{Extra}}</div>{{/Extra}}</div><script>buildOptions();</script>';

function makeMcqCollection(
  options: {
    question?: string;
    choices?: string;
    correct?: string;
    extra?: string;
  } = {}
): NormalizedCollection {
  const noteType = {
    id: 1,
    name: 'n2a-mcq',
    type: 0 as const,
    css: '#myCard { display: flex; }',
    fields: [
      { name: 'Question', ord: 0 },
      { name: 'Multiple Choice', ord: 1 },
      { name: 'Correct Answer', ord: 2 },
      { name: 'Extra', ord: 3 },
    ],
    templates: [
      {
        name: 'n2a-mcq',
        ord: 0,
        qfmt: MCQ_TEMPLATE_QFMT,
        afmt: MCQ_TEMPLATE_AFMT,
      },
    ],
  };

  const note = {
    id: 10,
    mid: 1,
    tags: '',
    fields: [
      options.question ?? 'What is the capital of Switzerland?',
      options.choices ?? 'Zurich<br>Bern<br>Geneva<br>Basel',
      options.correct ?? 'Bern',
      options.extra ?? 'Bern has been the capital since 1848.',
    ],
  };

  return {
    noteTypes: new Map([[1, noteType]]),
    notes: new Map([[10, note]]),
    decks: new Map([[2, { id: 2, name: 'Switzerland' }]]),
    cards: [{ id: 100, nid: 10, did: 2, ord: 0 }],
  };
}

function makeParsed(collection: NormalizedCollection) {
  return {
    collection,
    mediaMap: new Map<string, string>(),
    mediaEntries: new Map<string, Buffer>(),
    parsedAt: Date.now(),
  };
}

function makeClozeCollection(cardOrds: number[]): NormalizedCollection {
  const noteType = {
    id: 1,
    name: 'n2a-cloze',
    type: 1 as const,
    css: '',
    fields: [{ name: 'Text', ord: 0 }],
    templates: [
      {
        name: 'Cloze',
        ord: 0,
        qfmt: '{{cloze:Text}}',
        afmt: '{{cloze:Text}}',
      },
    ],
  };

  const note = {
    id: 10,
    mid: 1,
    tags: '',
    fields: ['{{c1::Paris}} is the capital of {{c2::France}}'],
  };

  const cards = cardOrds.map((ord, i) => ({
    id: 100 + i,
    nid: 10,
    did: 2,
    ord,
  }));

  return {
    noteTypes: new Map([[1, noteType]]),
    notes: new Map([[10, note]]),
    decks: new Map([[2, { id: 2, name: 'Demo' }]]),
    cards,
  };
}

function makeBadOrdClozeCollection(): NormalizedCollection {
  const noteType = {
    id: 1,
    name: 'n2a-cloze',
    type: 0 as const,
    css: '',
    fields: [{ name: 'Text', ord: 0 }],
    templates: [
      {
        name: 'Cloze',
        ord: 0,
        qfmt: '{{cloze:Text}}',
        afmt: '{{cloze:Text}}',
      },
    ],
  };

  const note = {
    id: 10,
    mid: 1,
    tags: '',
    fields: ['{{c1::Paris}} is the capital of {{c2::France}}'],
  };

  const validCard = { id: 100, nid: 10, did: 2, ord: 0 };
  const badOrdCard = { id: 101, nid: 10, did: 2, ord: 1 };

  return {
    noteTypes: new Map([[1, noteType]]),
    notes: new Map([[10, note]]),
    decks: new Map([[2, { id: 2, name: 'Demo' }]]),
    cards: [validCard, badOrdCard],
  };
}

describe('ApkgPreviewService.getCardsPage', () => {
  const service = new ApkgPreviewService();

  it('renders a cloze card at ord=0', () => {
    const parsed = makeParsed(makeClozeCollection([0]));
    const result = service.getCardsPage(parsed, 0, 10, 'http://example.com');
    expect(result.cards).toHaveLength(1);
    expect(result.cards[0].ord).toBe(0);
    expect(result.cards[0].noteTypeName).toBe('n2a-cloze');
  });

  it('renders cloze cards at ord=1 and higher without the template-ord warning', () => {
    const parsed = makeParsed(makeClozeCollection([0, 1]));
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const result = service.getCardsPage(parsed, 0, 10, 'http://example.com');
    warnSpy.mockRestore();

    expect(result.cards).toHaveLength(2);
    expect(result.cards[1].ord).toBe(1);
  });

  it('does not emit the template-ord warning for cloze cards with ord >= 1', () => {
    const parsed = makeParsed(makeClozeCollection([0, 1, 2]));
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});

    service.getCardsPage(parsed, 0, 10, 'http://example.com');

    const templateOrdWarnings = warnSpy.mock.calls.filter(([msg]) =>
      String(msg).includes('template ord=')
    );
    warnSpy.mockRestore();

    expect(templateOrdWarnings).toHaveLength(0);
  });

  describe('ord-out-of-range fallback', () => {
    it('emits a debug log when a card ord exceeds the noteType template count', () => {
      const parsed = makeParsed(makeBadOrdClozeCollection());
      const debugSpy = jest
        .spyOn(console, 'debug')
        .mockImplementation(() => {});

      service.getCardsPage(parsed, 0, 10, 'http://example.com');

      const templateOrdDebugs = debugSpy.mock.calls.filter(([msg]) =>
        String(msg).includes('template ord=')
      );
      debugSpy.mockRestore();

      expect(templateOrdDebugs).toHaveLength(1);
      expect(String(templateOrdDebugs[0][0])).toContain('n2a-cloze');
    });

    it('still renders the out-of-range card against ord=0 instead of dropping it', () => {
      const parsed = makeParsed(makeBadOrdClozeCollection());
      const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});

      const result = service.getCardsPage(parsed, 0, 10, 'http://example.com');
      warnSpy.mockRestore();

      expect(result.cards).toHaveLength(2);
      expect(result.cards.every((c) => c.noteTypeName === 'n2a-cloze')).toBe(
        true
      );
    });

    it('does not throw when a card ord exceeds the noteType template count', () => {
      const parsed = makeParsed(makeBadOrdClozeCollection());
      const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});

      expect(() =>
        service.getCardsPage(parsed, 0, 10, 'http://example.com')
      ).not.toThrow();
      warnSpy.mockRestore();
    });
  });

  describe('Image Occlusion masked preview', () => {
    function makeIoParsed() {
      return {
        collection: makeIoCollection(),
        mediaMap: new Map<string, string>([['study.png', '0']]),
        mediaEntries: new Map<string, Buffer>(),
        parsedAt: Date.now(),
      };
    }

    it('renders the masked image as an inline SVG over the base image', () => {
      const parsed = makeIoParsed();
      const result = service.getCardsPage(
        parsed,
        0,
        10,
        'http://example.com/media/'
      );

      expect(result.cards).toHaveLength(1);
      expect(result.cards[0].front).toContain('<svg');
      expect(result.cards[0].front).toContain('<image');
      expect(result.cards[0].front).toContain('<rect');
    });

    it('points the base image at the bundled media url, not a raw filename', () => {
      const parsed = makeIoParsed();
      const result = service.getCardsPage(
        parsed,
        0,
        10,
        'http://example.com/media/'
      );

      expect(result.cards[0].front).toContain(
        'href="http://example.com/media/study.png"'
      );
    });

    it('does not include <canvas> in the rendered output', () => {
      const parsed = makeIoParsed();
      const result = service.getCardsPage(parsed, 0, 10, 'http://example.com');

      expect(result.cards[0].front).not.toContain('<canvas');
      expect(result.cards[0].back).not.toContain('<canvas');
    });

    it('does not include <script> in the rendered output', () => {
      const parsed = makeIoParsed();
      const result = service.getCardsPage(parsed, 0, 10, 'http://example.com');

      expect(result.cards[0].front).not.toContain('<script');
      expect(result.cards[0].back).not.toContain('<script');
    });

    it('still includes the IO card in the deck list — does not drop it', () => {
      const parsed = makeIoParsed();
      const result = service.getCardsPage(parsed, 0, 10, 'http://example.com');

      expect(result.total).toBe(1);
      expect(result.cards).toHaveLength(1);
      expect(result.cards[0].noteTypeName).toBe('Image Occlusion');
    });
  });

  describe('MCQ static option list', () => {
    it('lists every option on the front, unmarked', () => {
      const parsed = makeParsed(makeMcqCollection());
      const result = service.getCardsPage(parsed, 0, 10, 'http://example.com');

      const front = result.cards[0].front;
      expect(front).toContain('Zurich');
      expect(front).toContain('Bern');
      expect(front).toContain('Geneva');
      expect(front).toContain('Basel');
      expect(front).not.toContain('<mark>');
    });

    it('marks the correct option on the back and keeps the rest plain', () => {
      const parsed = makeParsed(makeMcqCollection());
      const result = service.getCardsPage(parsed, 0, 10, 'http://example.com');

      const back = result.cards[0].back;
      expect(back).toContain('<mark>✓ <strong>Bern</strong></mark>');
      expect(back).not.toContain('<mark>✓ <strong>Zurich</strong></mark>');
    });

    it('renders the Extra explanation on the back', () => {
      const parsed = makeParsed(makeMcqCollection());
      const result = service.getCardsPage(parsed, 0, 10, 'http://example.com');

      expect(result.cards[0].back).toContain(
        'Bern has been the capital since 1848.'
      );
    });

    it('falls back to a labeled answer line when Correct Answer matches no option', () => {
      const parsed = makeParsed(makeMcqCollection({ correct: 'Lausanne' }));
      const result = service.getCardsPage(parsed, 0, 10, 'http://example.com');

      const back = result.cards[0].back;
      expect(back).not.toContain('<mark>');
      expect(back).toContain('Correct answer: Lausanne');
    });

    it('does not include <script> or <form> in the rendered output', () => {
      const parsed = makeParsed(makeMcqCollection());
      const result = service.getCardsPage(parsed, 0, 10, 'http://example.com');

      expect(result.cards[0].front).not.toContain('<script');
      expect(result.cards[0].front).not.toContain('<form');
      expect(result.cards[0].back).not.toContain('<script');
      expect(result.cards[0].back).not.toContain('<form');
    });

    it('still includes the MCQ card in the deck list — does not drop it', () => {
      const parsed = makeParsed(makeMcqCollection());
      const result = service.getCardsPage(parsed, 0, 10, 'http://example.com');

      expect(result.total).toBe(1);
      expect(result.cards).toHaveLength(1);
      expect(result.cards[0].noteTypeName).toBe('n2a-mcq');
    });
  });
});
