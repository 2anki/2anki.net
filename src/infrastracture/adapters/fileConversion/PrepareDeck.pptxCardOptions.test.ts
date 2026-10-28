import { vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { strToU8, zipSync } from 'fflate';

const SLIDE_PNG = vi.hoisted(() =>
  Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
    'base64'
  )
);
const pageImage = vi.hoisted(
  () => (page: number) =>
    Buffer.concat([SLIDE_PNG, Buffer.from(`page ${page}`)])
);

vi.mock('./ConvertPPTToPDF', () => ({
  convertPPTToPDF: vi.fn().mockResolvedValue(Buffer.from('%PDF-1.4 slides')),
}));

vi.mock('../../../lib/pdf/getPageCount', () => ({
  getPageCount: vi.fn().mockResolvedValue(2),
}));

// Stands in for pdftoppm, which writes page n of a deck under ten pages next
// to the PDF as <pdf>-page<n>-<n>.png.
vi.mock('../../../lib/pdf/convertPage', () => ({
  convertPage: vi.fn(async (pdfPath: string, pageNumber: number) => {
    const { writeFileSync } = await import('node:fs');
    const imagePath = `${pdfPath}-page${pageNumber}-${pageNumber}.png`;
    writeFileSync(imagePath, pageImage(pageNumber));
    return imagePath;
  }),
}));

vi.mock('../../../services/events/track', () => ({
  track: vi.fn(),
}));

import { PrepareDeck } from './PrepareDeck';
import CardOption from '../../../lib/parser/Settings/CardOption';
import Workspace from '../../../lib/parser/WorkSpace';
import getUniqueFileName from '../../../lib/misc/getUniqueFileName';
import { mcpOptionsToCardSettings } from '../../../services/mcp/mcpOptionsToCardSettings';
import { getPageCount } from '../../../lib/pdf/getPageCount';
import { detectOverSplit } from '../../../lib/parser/detectOverSplit';

// The note-ID tests need the Python build step, which runs only when
// SKIP_CREATE_DECK is unset. CI sets it, so they run in the local full suite.
const BUILDS_WITH_PYTHON = process.env.SKIP_CREATE_DECK == null;

const NAMESPACES =
  'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"';

function textShape(placeholder: string, text: string): string {
  return `<p:sp><p:nvSpPr><p:nvPr>${placeholder}</p:nvPr></p:nvSpPr><p:txBody><a:p><a:r><a:t>${text}</a:t></a:r></a:p></p:txBody></p:sp>`;
}

function slideNumber(n: string): string {
  return `<p:sp><p:nvSpPr><p:nvPr><p:ph type="sldNum" sz="quarter" idx="12"/></p:nvPr></p:nvSpPr><p:txBody><a:p><a:fld id="{B6F15528-21DE-4FAA-801E-634DDDAF4B2B}" type="slidenum"><a:t>${n}</a:t></a:fld></a:p></p:txBody></p:sp>`;
}

function slide(shapes: string[]): Uint8Array {
  return strToU8(
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:sld ${NAMESPACES}><p:cSld><p:spTree>${shapes.join('')}</p:spTree></p:cSld></p:sld>`
  );
}

const footer = textShape(
  '<p:ph type="ftr" sz="quarter" idx="11"/>',
  'Cell Biology'
);
const picture =
  '<p:pic><p:nvPicPr><p:cNvPr id="5" name="Diagram"/></p:nvPicPr></p:pic>';

const figureLecture = Buffer.from(
  zipSync({
    'ppt/slides/slide1.xml': slide([
      textShape('<p:ph type="title"/>', 'Mitosis'),
      footer,
      slideNumber('1'),
    ]),
    'ppt/slides/slide2.xml': slide([picture, footer, slideNumber('2')]),
  })
);

function notes(text: string): Uint8Array {
  return strToU8(
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:notes ${NAMESPACES}><p:cSld><p:spTree><p:sp><p:nvSpPr><p:nvPr><p:ph type="body" idx="1"/></p:nvPr></p:nvSpPr><p:txBody><a:p><a:r><a:t>${text}</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:notes>`
  );
}

const typingLecture = Buffer.from(
  zipSync({
    'ppt/slides/slide1.xml': slide([
      textShape('<p:ph type="title"/>', 'Mitosis'),
      textShape('<p:ph idx="1"/>', 'Prophase'),
      footer,
      slideNumber('1'),
    ]),
    'ppt/slides/slide2.xml': slide([picture, footer, slideNumber('2')]),
    'ppt/slides/slide3.xml': slide([picture, footer, slideNumber('3')]),
    'ppt/notesSlides/notesSlide3.xml': notes('Label the phases'),
    'ppt/slides/slide4.xml': slide([picture, slideNumber('4')]),
  })
);

const listLecture = Buffer.from(
  zipSync({
    'ppt/slides/slide1.xml': slide([
      textShape('<p:ph type="title"/>', 'Mitosis'),
      `<p:sp><p:nvSpPr><p:nvPr><p:ph idx="1"/></p:nvPr></p:nvSpPr><p:txBody><a:p><a:r><a:t>Prophase</a:t></a:r></a:p><a:p><a:r><a:t>Metaphase</a:t></a:r></a:p></p:txBody></p:sp>`,
      footer,
      slideNumber('1'),
    ]),
    'ppt/slides/slide2.xml': slide([
      textShape('<p:ph type="title"/>', 'Meiosis'),
      textShape('<p:ph idx="1"/>', 'Gametes'),
      footer,
      slideNumber('2'),
    ]),
    'ppt/slides/slide3.xml': slide([
      slideNumber('19'),
      textShape('', '03'),
      textShape('', 'Exocytosis'),
      textShape('', 'Ca2+ influx triggers fusion'),
      footer,
    ]),
  })
);

const runOnLecture = Buffer.from(
  zipSync({
    'ppt/slides/slide1.xml': slide([
      textShape('<p:ph type="title"/>', 'Mitosis'),
      `<p:sp><p:nvSpPr><p:nvPr><p:ph idx="1"/></p:nvPr></p:nvSpPr><p:txBody><a:p><a:r><a:t>Prophase</a:t></a:r></a:p><a:p><a:r><a:t>Metaphase</a:t></a:r></a:p><a:p><a:r><a:t>Anaphase</a:t></a:r></a:p></p:txBody></p:sp>`,
      footer,
      textShape('<p:ph type="dt" sz="half" idx="10"/>', '10/6/2026'),
      slideNumber('1'),
    ]),
    'ppt/slides/slide2.xml': slide([
      slideNumber('19'),
      textShape('', '03'),
      textShape('', 'Exocytosis'),
      textShape('', 'Ca2+ influx triggers fusion'),
      footer,
    ]),
  })
);

const japaneseLecture = Buffer.from(
  zipSync({
    'ppt/slides/slide1.xml': slide([
      textShape('<p:ph type="title"/>', '細胞の構造'),
      footer,
      slideNumber('1'),
    ]),
    'ppt/slides/slide2.xml': slide([
      textShape('<p:ph type="title"/>', 'ミトコンドリアの役割'),
      footer,
      slideNumber('2'),
    ]),
    'ppt/slides/slide3.xml': slide([picture, footer, slideNumber('3')]),
    'ppt/slides/slide4.xml': slide([picture, footer, slideNumber('4')]),
    'ppt/slides/slide5.xml': slide([picture, footer, slideNumber('5')]),
  })
);

function lectureWithFooter(footerText: string): Buffer {
  const footerShape = textShape(
    '<p:ph type="ftr" sz="quarter" idx="11"/>',
    footerText
  );
  return Buffer.from(
    zipSync({
      'ppt/slides/slide1.xml': slide([
        textShape('<p:ph type="title"/>', 'Mitosis'),
        textShape('<p:ph idx="1"/>', 'Prophase'),
        footerShape,
        slideNumber('1'),
      ]),
      'ppt/slides/slide2.xml': slide([picture, footerShape, slideNumber('2')]),
    })
  );
}

function lectureOf(count: number, shapes: (n: number) => string[]): Buffer {
  const files: Record<string, Uint8Array> = {};
  for (let n = 1; n <= count; n += 1) {
    files[`ppt/slides/slide${n}.xml`] = slide(shapes(n));
  }
  return Buffer.from(zipSync(files));
}

function pageMedia(page: number): string {
  return `${getUniqueFileName(pageImage(page))}.png`;
}

function visibleText(html: string): string {
  return html
    .replaceAll(/<img[^>]*>/g, ' [slide image] ')
    .replaceAll(/<[^>]+>/g, ' ')
    .replaceAll(/\s+/g, ' ')
    .trim();
}

describe('PrepareDeck — card options on a .pptx whose figure slide has only chrome', () => {
  const workspaces: Workspace[] = [];
  const skipCreateDeck = process.env.SKIP_CREATE_DECK;

  beforeAll(() => {
    process.env.SKIP_CREATE_DECK = 'true';
  });

  afterAll(() => {
    if (skipCreateDeck == null) {
      delete process.env.SKIP_CREATE_DECK;
    } else {
      process.env.SKIP_CREATE_DECK = skipCreateDeck;
    }
  });

  afterEach(() => {
    for (const used of workspaces.splice(0)) {
      fs.rmSync(used.location, { recursive: true, force: true });
    }
    vi.mocked(getPageCount).mockResolvedValue(2);
  });

  async function prepareWith(settings: CardOption, deck: Buffer) {
    const workspace = new Workspace(true, 'fs');
    workspaces.push(workspace);
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const debug = vi.spyOn(console, 'debug').mockImplementation(() => {});
    try {
      return await PrepareDeck({
        name: 'lecture.pptx',
        files: [{ name: 'lecture.pptx', contents: deck }],
        settings,
        noLimits: true,
        workspace,
      });
    } finally {
      log.mockRestore();
      debug.mockRestore();
    }
  }

  async function convertWith(settings: CardOption, deck: Buffer) {
    const result = await prepareWith(settings, deck);
    return result?.deck.flatMap((deck) => deck.cards) ?? [];
  }

  function withDefaults(options: Record<string, string>): CardOption {
    return new CardOption({ ...CardOption.LoadDefaultOptions(), ...options });
  }

  function convert(
    options: Record<string, string>,
    deck: Buffer = figureLecture
  ) {
    return convertWith(withDefaults(options), deck);
  }

  it.each(['show-all', 'windowed'])(
    'keeps each slide one card with its own embedded page under overlapping cloze %s',
    async (style) => {
      const cards = await convert({
        cloze: 'true',
        'overlapping-cloze': style,
      });

      expect(cards.map((card) => card.media)).toEqual([
        [pageMedia(1)],
        [pageMedia(2)],
      ]);
    }
  );

  it.each(['true', 'false'])(
    'answers each slide with its slide number and footer when backs are plain text (cloze %s)',
    async (cloze) => {
      const cards = await convert({ paragraph: 'true', cloze });

      expect(
        cards.map((card) => ({
          front: visibleText(card.name),
          back: visibleText(card.back),
        }))
      ).toEqual([
        { front: 'Mitosis', back: 'Cell Biology · 1' },
        { front: '[slide image]', back: 'Cell Biology · 2' },
      ]);
    }
  );

  it('asks the slide number and footer and answers with the slide image on the reversed card (Reversed only)', async () => {
    const cards = await convert({ reversed: 'true' });

    expect(
      cards.map((card) => ({
        front: visibleText(card.name),
        back: card.back.includes(`<img src="${pageMedia(2)}"`)
          ? 'page 2'
          : visibleText(card.back),
      }))
    ).toEqual([
      { front: '[slide image] Cell Biology · 1', back: 'Mitosis' },
      { front: 'Cell Biology · 2', back: 'page 2' },
    ]);
  });

  it('adds a reversed card asking the slide number and footer for the figure slide (Basic and reversed, MCP noteType basic-reversed)', async () => {
    const cards = await convert(
      mcpOptionsToCardSettings({ noteType: 'basic-reversed' })
    );

    expect(
      cards.map((card) => ({
        front: visibleText(card.name),
        back: visibleText(card.back),
      }))
    ).toEqual([
      { front: 'Mitosis', back: '[slide image] Cell Biology · 1' },
      { front: '[slide image]', back: 'Cell Biology · 2' },
      { front: '[slide image] Cell Biology · 1', back: 'Mitosis' },
      { front: 'Cell Biology · 2', back: '[slide image]' },
    ]);
  });

  it('makes the same cards with MCP noteType mcq as with cloze off, since the slides hold no answer list', async () => {
    const mcq = await convert(mcpOptionsToCardSettings({ noteType: 'mcq' }));
    const clozeOff = await convert({ cloze: 'false' });

    expect(mcq).toEqual(clozeOff);
  });

  describe('when the answer is typed (MCP noteType input)', () => {
    beforeEach(() => {
      vi.mocked(getPageCount).mockResolvedValue(4);
    });

    afterEach(() => {
      vi.mocked(getPageCount).mockResolvedValue(2);
    });

    function typing(cards: Awaited<ReturnType<typeof convert>>) {
      return cards.map((card) => ({
        typed: card.enableInput,
        answer: card.answer,
      }));
    }

    it('types the speaker note of a picture slide, never a slide number or footer', async () => {
      const cards = await convert(
        mcpOptionsToCardSettings({ noteType: 'input' }),
        typingLecture
      );

      expect(typing(cards)).toEqual([
        { typed: false, answer: '' },
        { typed: false, answer: '' },
        { typed: true, answer: 'Label the phases' },
        { typed: false, answer: '' },
      ]);
    });

    it('types the speaker note of a picture slide, never a slide number or footer, with no saved options merged', async () => {
      const cards = await convertWith(
        new CardOption(mcpOptionsToCardSettings({ noteType: 'input' })),
        typingLecture
      );

      expect(typing(cards)).toEqual([
        { typed: false, answer: '' },
        { typed: false, answer: '' },
        { typed: true, answer: 'Label the phases' },
        { typed: false, answer: '' },
      ]);
    });

    it('types the speaker note of a picture slide, never a slide number or footer, with "Preserve newlines" on', async () => {
      const cards = await convert(
        {
          ...mcpOptionsToCardSettings({ noteType: 'input' }),
          'perserve-newlines': 'true',
        },
        typingLecture
      );

      expect(cards[1].back.startsWith('<br />')).toBe(true);
      expect(typing(cards)).toEqual([
        { typed: false, answer: '' },
        { typed: false, answer: '' },
        { typed: true, answer: 'Label the phases' },
        { typed: false, answer: '' },
      ]);
    });

    it('types a short body or speaker note, never a slide number or footer, when backs are plain text', async () => {
      const cards = await convert(
        {
          ...mcpOptionsToCardSettings({ noteType: 'input' }),
          paragraph: 'true',
        },
        typingLecture
      );

      expect(typing(cards)).toEqual([
        { typed: true, answer: 'Prophase' },
        { typed: false, answer: '' },
        { typed: true, answer: 'Label the phases' },
        { typed: false, answer: '' },
      ]);
    });
  });

  it('keeps both directions of the figure slide with typed answers and Basic and reversed on', async () => {
    vi.mocked(getPageCount).mockResolvedValue(2);
    const cards = await convert({
      ...mcpOptionsToCardSettings({ noteType: 'input' }),
      'basic-reversed': 'true',
    });

    expect(
      cards.map((card) => ({
        front: visibleText(card.name),
        back: visibleText(card.back),
        typed: card.enableInput,
      }))
    ).toEqual([
      {
        front: 'Mitosis',
        back: '[slide image] Cell Biology · 1',
        typed: false,
      },
      { front: '[slide image]', back: 'Cell Biology · 2', typed: false },
      {
        front: '[slide image] Cell Biology · 1',
        back: 'Mitosis',
        typed: false,
      },
      { front: 'Cell Biology · 2', back: '[slide image]', typed: false },
    ]);
  });

  it('keeps a plain-text back of several lines as a basic card with its reversed card when typed answers are on (Basic and reversed)', async () => {
    vi.mocked(getPageCount).mockResolvedValue(2);
    const cards = await convert(
      {
        ...mcpOptionsToCardSettings({ noteType: 'input' }),
        paragraph: 'true',
        'basic-reversed': 'true',
      },
      runOnLecture
    );

    expect(
      cards.map((card) => ({
        front: visibleText(card.name),
        typed: card.enableInput,
        answer: card.answer,
      }))
    ).toEqual([
      { front: 'Mitosis', typed: false, answer: '' },
      { front: 'Exocytosis', typed: false, answer: '' },
      { front: 'Prophase Metaphase Anaphase', typed: false, answer: '' },
      { front: '03 Ca2+ influx triggers fusion', typed: false, answer: '' },
    ]);
  });

  it.each([
    { option: 'cherry', emoji: '🍒', kept: ['[slide image]'] },
    { option: 'avocado', emoji: '🥑', kept: ['Mitosis'] },
  ])(
    'keeps a footer $emoji only on the slide whose back is its source line ($option)',
    async ({ option, emoji, kept }) => {
      vi.mocked(getPageCount).mockResolvedValue(2);
      const cards = await convert(
        { [option]: 'true' },
        lectureWithFooter(`${emoji} Cell Biology`)
      );

      expect(cards.map((card) => visibleText(card.name))).toEqual(kept);
    }
  );

  it('falls back to cards made from slide lines when cherry-pick drops every slide whose 🍒 is only in its footer (pinned)', async () => {
    const cherryFooter = textShape(
      '<p:ph type="ftr" sz="quarter" idx="11"/>',
      '🍒 Cell Biology'
    );
    const cards = await convert(
      { cherry: 'true' },
      Buffer.from(
        zipSync({
          'ppt/slides/slide1.xml': slide([
            textShape('<p:ph type="title"/>', 'Mitosis'),
            textShape('<p:ph idx="1"/>', 'Prophase'),
            cherryFooter,
            slideNumber('1'),
          ]),
          'ppt/slides/slide2.xml': slide([
            textShape('<p:ph type="title"/>', 'Meiosis'),
            textShape('<p:ph idx="1"/>', 'Gametes'),
            cherryFooter,
            slideNumber('2'),
          ]),
        })
      )
    );

    expect(cards.map((card) => visibleText(card.name))).toEqual([
      'Mitosis Prophase [slide image]',
      'Prophase',
      'Prophase',
      'Meiosis Gametes [slide image]',
      'Gametes',
      'Gametes',
    ]);
  });

  it('ships the source line in the back with its data-2anki-slide-source marker', async () => {
    const cards = await convert({});

    expect(cards[1].back).toContain(
      '<p data-2anki-slide-source="">Cell Biology · 2</p>'
    );
  });

  it('does not type a title-only slide whose back is its title and source line on two lines', async () => {
    vi.mocked(getPageCount).mockResolvedValue(1);
    const cards = await convert(
      {
        ...mcpOptionsToCardSettings({ noteType: 'input' }),
        paragraph: 'true',
      },
      Buffer.from(
        zipSync({
          'ppt/slides/slide1.xml': slide([
            textShape('<p:ph type="title"/>', 'y'),
            footer,
            slideNumber('6'),
          ]),
        })
      )
    );

    expect(
      cards.map((card) => ({ typed: card.enableInput, answer: card.answer }))
    ).toEqual([{ typed: false, answer: '' }]);
  });

  it('detects Japanese from the slide titles when more figure slides carry a Latin footer (tts-auto-detect)', async () => {
    vi.mocked(getPageCount).mockResolvedValue(5);
    const result = await prepareWith(
      withDefaults({ 'tts-auto-detect': 'true' }),
      japaneseLecture
    );

    expect(result?.deck[0].settings?.frontLang).toBe('ja');
  });

  it('reads what the back holds under back-side text-to-speech: the body of a titled slide, the source line of a picture slide (MCP tts side back)', async () => {
    vi.mocked(getPageCount).mockResolvedValue(4);
    const result = await prepareWith(
      withDefaults(
        mcpOptionsToCardSettings({
          tts: { enabled: true, language: 'en_US', side: 'back' },
        })
      ),
      typingLecture
    );

    expect(result?.deck[0].settings).toMatchObject({
      ttsManualLang: 'en_US',
      ttsManualSide: 'back',
    });
    expect(
      result?.deck
        .flatMap((deck) => deck.cards)
        .map((card) => visibleText(card.back))
    ).toEqual([
      'Prophase [slide image]',
      'Cell Biology · 2',
      'Label the phases',
      '4',
    ]);
  });

  describe('on a 200-slide deck', () => {
    beforeEach(() => {
      vi.mocked(getPageCount).mockResolvedValue(200);
    });

    afterEach(() => {
      vi.mocked(getPageCount).mockResolvedValue(2);
    });

    it('leaves the over-split notice off when untitled slides front their heading, not their slide number', async () => {
      const cards = await convert(
        {},
        lectureOf(200, (n) => [
          slideNumber(String(n)),
          textShape('', '03'),
          textShape('', 'Exocytosis releases vesicle cargo'),
          footer,
        ])
      );

      expect(cards).toHaveLength(200);
      expect(detectOverSplit(cards.map((card) => card.name))).toBe(false);
    });

    it('turns the over-split notice on when figure slides front their image, not a long footer', async () => {
      const longFooter = textShape(
        '<p:ph type="ftr" sz="quarter" idx="11"/>',
        'Introduction to Cell Biology, Fall 2026'
      );
      const cards = await convert(
        {},
        lectureOf(200, (n) => [picture, longFooter, slideNumber(String(n))])
      );

      expect(cards).toHaveLength(200);
      expect(detectOverSplit(cards.map((card) => card.name))).toBe(true);
    });
  });

  describe('when a slide has a body list and chrome', () => {
    beforeEach(() => {
      vi.mocked(getPageCount).mockResolvedValue(3);
    });

    afterEach(() => {
      vi.mocked(getPageCount).mockResolvedValue(2);
    });

    it.each(['show-all', 'windowed'])(
      'turns only the body lines into overlapping cloze notes, never the slide number or footer (%s)',
      async (style) => {
        const cards = await convert(
          { cloze: 'true', 'overlapping-cloze': style },
          listLecture
        );

        expect(
          cards.map((card) => ({
            front: visibleText(card.name),
            media: card.media.length,
          }))
        ).toEqual([
          { front: 'Meiosis', media: 1 },
          { front: '{{c1::Prophase}} Metaphase', media: 0 },
          { front: 'Prophase {{c1::Metaphase}}', media: 0 },
          { front: '{{c1::03}} Ca2+ influx triggers fusion', media: 0 },
          { front: '03 {{c1::Ca2+ influx triggers fusion}}', media: 0 },
        ]);
      }
    );
  });
});

(BUILDS_WITH_PYTHON ? describe : describe.skip)(
  'PrepareDeck — note IDs the Python build gives .pptx cards',
  () => {
    const workspaces: Workspace[] = [];

    beforeEach(() => {
      vi.mocked(getPageCount).mockResolvedValue(2);
    });

    afterEach(() => {
      for (const used of workspaces.splice(0)) {
        fs.rmSync(used.location, { recursive: true, force: true });
      }
    });

    async function noteIds(options: Record<string, string>, deck: Buffer) {
      const workspace = new Workspace(true, 'fs');
      workspaces.push(workspace);
      const log = vi.spyOn(console, 'log').mockImplementation(() => {});
      const debug = vi.spyOn(console, 'debug').mockImplementation(() => {});
      try {
        const result = await PrepareDeck({
          name: 'lecture.pptx',
          files: [{ name: 'lecture.pptx', contents: deck }],
          settings: new CardOption({
            ...CardOption.LoadDefaultOptions(),
            ...options,
          }),
          noLimits: true,
          workspace,
        });
        const guids: { guid: string }[] = JSON.parse(
          fs.readFileSync(path.join(workspace.location, 'guids.json'), 'utf8')
        );
        return (result?.deck.flatMap((deck) => deck.cards) ?? []).map(
          (card, index) => ({
            front: visibleText(card.name),
            guid: guids[index].guid,
          })
        );
      } finally {
        log.mockRestore();
        debug.mockRestore();
      }
    }

    it("gives the chrome-only picture slide a new note ID and keeps the titled slide's", async () => {
      const now = await noteIds({}, figureLecture);
      const beforeChromeDetection = await noteIds(
        { 'embed-images': 'false' },
        figureLecture
      );

      expect(now.map((note) => note.front)).toEqual([
        'Mitosis',
        '[slide image]',
      ]);
      expect(beforeChromeDetection.map((note) => note.front)).toEqual([
        'Mitosis',
        'Cell Biology',
      ]);
      expect(now[0].guid).toBe(beforeChromeDetection[0].guid);
      expect(now[1].guid).not.toBe(beforeChromeDetection[1].guid);
    });

    it('gives a note a new ID when it flips from basic to typed, its front unchanged', async () => {
      const oneLineBacks = lectureWithFooter('Cell Biology');
      const basic = await noteIds(
        { cloze: 'false', paragraph: 'true', 'basic-reversed': 'true' },
        oneLineBacks
      );
      const typed = await noteIds(
        {
          ...mcpOptionsToCardSettings({ noteType: 'input' }),
          paragraph: 'true',
          'basic-reversed': 'true',
        },
        oneLineBacks
      );

      expect(basic[0].front).toBe('Mitosis');
      expect(typed[0].front).toBe('Mitosis {{type:Input}}');
      expect(typed[0].guid).not.toBe(basic[0].guid);
    });
  }
);
