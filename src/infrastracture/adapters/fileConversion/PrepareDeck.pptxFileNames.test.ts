import { vi } from 'vitest';
import fs from 'node:fs';
import { strToU8, zipSync } from 'fflate';

const SLIDE_PNG = vi.hoisted(() =>
  Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
    'base64'
  )
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
    writeFileSync(imagePath, SLIDE_PNG);
    return imagePath;
  }),
}));

vi.mock('../../../services/events/track', () => ({
  track: vi.fn(),
}));

import { PrepareDeck } from './PrepareDeck';
import CardOption from '../../../lib/parser/Settings/CardOption';
import Workspace from '../../../lib/parser/WorkSpace';

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

describe('PrepareDeck — a .pptx whose file name a URL would escape', () => {
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

  it.each([
    'lecture.pptx',
    'Lecture%203.pptx',
    'Cell "Biology".pptx',
    'Lecture %22final%22.pptx',
    '50% done.pptx',
  ])(
    'embeds the slide image that fronts the picture slide of a deck named %s',
    async (name) => {
      workspace = new Workspace(true, 'fs');
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

        const diagram = result?.deck[0].cards[1];
        expect(diagram?.media).toHaveLength(1);
        expect(diagram?.name).toContain(`<img src="${diagram?.media[0]}"`);
      } finally {
        log.mockRestore();
        debug.mockRestore();
      }
    }
  );
});
