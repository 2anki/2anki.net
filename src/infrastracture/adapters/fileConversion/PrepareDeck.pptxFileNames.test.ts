import { vi } from 'vitest';
import fs from 'node:fs';
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
// to the PDF as <pdf>-page<n>-<n>.png, so the upload's name reaches the file.
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
import { getPageCount } from '../../../lib/pdf/getPageCount';

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

const lecture = Buffer.from(
  zipSync({
    'ppt/slides/slide1.xml': slide([
      textShape('<p:ph type="title"/>', 'Mitosis'),
      textShape('<p:ph idx="1"/>', 'Prophase'),
      footer,
      slideNumber('1'),
    ]),
    'ppt/slides/slide2.xml': slide([picture, footer, slideNumber('2')]),
  })
);

const ESCAPED_NAMES = [
  { label: 'an MCP URL escape', name: 'Lecture%203.pptx' },
  { label: 'a double quote', name: 'Cell "Biology".pptx' },
  { label: "a web upload's %22", name: 'Lecture %22final%22.pptx' },
  { label: 'a bare percent sign', name: '50% done.pptx' },
  { label: 'a lone surrogate', name: 'Lecture \uD800.pptx' },
  { label: 'a backslash', name: 'Cell\\Biology.pptx' },
  { label: 'two dots before a backslash', name: 'Week 4..\\Cells.pptx' },
  { label: 'an entity-like name', name: 'Cells &amp; Tissues.pptx' },
  { label: 'a hash and a question mark', name: 'Week #3 why?.pptx' },
  { label: 'non-Latin letters', name: 'Übung 3 細胞.pptx' },
];

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

describe('PrepareDeck — a .pptx whose file name a URL would escape', () => {
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
    for (const workspace of workspaces.splice(0)) {
      fs.rmSync(workspace.location, { recursive: true, force: true });
    }
  });

  async function convert(name: string) {
    const workspace = new Workspace(true, 'fs');
    workspaces.push(workspace);
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const debug = vi.spyOn(console, 'debug').mockImplementation(() => {});
    try {
      const result = await PrepareDeck({
        name,
        files: [{ name, contents: lecture }],
        settings: new CardOption(CardOption.LoadDefaultOptions()),
        noLimits: true,
        workspace,
      });
      return (result?.deck ?? []).flatMap((deck) =>
        deck.cards.map((card) => ({
          name: card.name,
          back: card.back,
          media: card.media,
        }))
      );
    } finally {
      log.mockRestore();
      debug.mockRestore();
    }
  }

  it.each([
    { label: 'no character a URL escapes', name: 'lecture.pptx' },
    ...ESCAPED_NAMES,
  ])(
    'embeds each rendered page on its own slide card, the picture slide fronted by its page, for a name with $label',
    async ({ name }) => {
      const cards = await convert(name);

      expect(cards.map((card) => card.media)).toEqual([
        [pageMedia(1)],
        [pageMedia(2)],
      ]);
      expect(cards[1].name).toContain(`<img src="${pageMedia(2)}"`);
    }
  );

  describe.each([1, 3])(
    'with %i rendered pages for the two slides',
    (pageCount) => {
      beforeEach(() => {
        vi.mocked(getPageCount).mockResolvedValue(pageCount);
      });

      afterEach(() => {
        vi.mocked(getPageCount).mockResolvedValue(2);
      });

      it.each(ESCAPED_NAMES)(
        'builds the deck a plain name gets from the builder before chrome detection, every page included, for a name with $label',
        async ({ name }) => {
          const plain = await convert('lecture.pptx');
          const escaped = await convert(name);

          expect(escaped.map((card) => visibleText(card.name))).toEqual([
            'Mitosis',
            'Cell Biology',
          ]);
          expect(escaped).toEqual(plain);
        }
      );
    }
  );
});
