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
  let workspace: Workspace | null = null;
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
    if (workspace != null) {
      fs.rmSync(workspace.location, { recursive: true, force: true });
      workspace = null;
    }
  });

  async function convert(options: Record<string, string>) {
    workspace = new Workspace(true, 'fs');
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const debug = vi.spyOn(console, 'debug').mockImplementation(() => {});
    try {
      const result = await PrepareDeck({
        name: 'lecture.pptx',
        files: [{ name: 'lecture.pptx', contents: figureLecture }],
        settings: new CardOption({
          ...CardOption.LoadDefaultOptions(),
          ...options,
        }),
        noLimits: true,
        workspace,
      });
      return result?.deck.flatMap((deck) => deck.cards) ?? [];
    } finally {
      log.mockRestore();
      debug.mockRestore();
    }
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
});
