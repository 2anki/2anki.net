import { vi } from 'vitest';
import fs from 'node:fs';

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

// A .ppt (and a .pptx with no slide text) goes through LibreOffice to a PDF
// and then to one image per page, named after the upload; the deck that comes
// back must not depend on characters a URL would escape in that name.
const SLIDES = Buffer.from('binary ppt stands in; LibreOffice is mocked');

// A two-page PDF with no text on either page, like a scanned handout: the
// text reader finds nothing, so the person's PDF answer decides the images.
function blankPdf(): Buffer {
  const objects = [
    '<</Type/Catalog/Pages 2 0 R>>',
    '<</Type/Pages/Kids[3 0 R 4 0 R]/Count 2>>',
    '<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]>>',
    '<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]>>',
  ];
  let body = '%PDF-1.4\n';
  const offsets: number[] = [];
  objects.forEach((object, i) => {
    offsets.push(body.length);
    body += `${i + 1} 0 obj${object}endobj\n`;
  });
  const xref = body.length;
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) {
    body += `${String(offset).padStart(10, '0')} 00000 n \n`;
  }
  body += `trailer<</Size ${objects.length + 1}/Root 1 0 R>>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(body, 'latin1');
}

const ESCAPED_NAMES = [
  { label: 'an MCP URL escape', name: 'Lecture%203.ppt' },
  { label: 'a double quote', name: 'Cell "Biology".ppt' },
  { label: "a web upload's %22", name: 'Lecture %22final%22.ppt' },
  { label: 'a bare percent sign', name: '50% done.ppt' },
  { label: 'a lone surrogate', name: 'Lecture \uD800.ppt' },
  { label: 'a backslash', name: 'Cell\\Biology.ppt' },
  { label: 'two dots before a backslash', name: 'Week 4..\\Cells.ppt' },
  { label: 'an entity-like name', name: 'Cells &amp; Tissues.ppt' },
  { label: 'a hash and a question mark', name: 'Week #3 why?.ppt' },
  { label: 'markup', name: 'Week <b>3</b>.ppt' },
  { label: 'non-Latin letters', name: 'Übung 3 細胞.ppt' },
];

function pageMedia(page: number): string {
  return `${getUniqueFileName(pageImage(page))}.png`;
}

describe('PrepareDeck — a page-image deck whose file name a URL would escape', () => {
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

  async function prepare(
    name: string,
    options: Record<string, string> = {},
    contents: Buffer = SLIDES
  ) {
    const workspace = new Workspace(true, 'fs');
    workspaces.push(workspace);
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const debug = vi.spyOn(console, 'debug').mockImplementation(() => {});
    try {
      const result = await PrepareDeck({
        name,
        files: [{ name, contents }],
        settings: new CardOption({
          ...CardOption.LoadDefaultOptions(),
          ...options,
        }),
        noLimits: true,
        workspace,
      });
      return result?.deck ?? [];
    } finally {
      log.mockRestore();
      debug.mockRestore();
    }
  }

  async function convert(
    name: string,
    options: Record<string, string> = {},
    contents: Buffer = SLIDES
  ) {
    return (await prepare(name, options, contents)).flatMap((deck) =>
      deck.cards.map((card) => ({
        name: card.name,
        back: card.back,
        media: card.media,
      }))
    );
  }

  it.each([
    { label: 'no character a URL escapes', name: 'lecture.ppt' },
    ...ESCAPED_NAMES,
  ])('embeds both rendered pages for a name with $label', async ({ name }) => {
    const cards = await convert(name);

    expect(cards.flatMap((card) => card.media)).toEqual([
      pageMedia(1),
      pageMedia(2),
    ]);
  });

  it.each(ESCAPED_NAMES)(
    'builds the same deck a plain name gets, for a name with $label',
    async ({ name }) => {
      const plain = await convert('lecture.ppt');
      const escaped = await convert(name);

      expect(escaped).toEqual(plain);
    }
  );
  it.each(ESCAPED_NAMES)(
    'builds the same page-pair deck from a PDF a plain name gets, for a name with $label',
    async ({ name }) => {
      const pdfName = name.replace(/\.ppt$/, '.pdf');
      const pagePairs = { 'pdf-page-pairs': 'true' };
      const plain = await convert('lecture.pdf', pagePairs);
      const escaped = await convert(pdfName, pagePairs);

      expect(plain.flatMap((card) => card.media)).toEqual([
        pageMedia(1),
        pageMedia(2),
      ]);
      expect(escaped).toEqual(plain);
    }
  );
  it.each([
    ['answered "one card per page"', { 'pdf-fallback': 'single' }],
    ['answered "two pages per card"', { 'pdf-fallback': 'pairs' }],
  ])(
    'builds the same page-image deck from a PDF with no readable text when the person %s, for every escaped name',
    async (_label, options) => {
      const plain = await convert('lecture.pdf', options, blankPdf());
      expect(plain.flatMap((card) => card.media)).toEqual([
        pageMedia(1),
        pageMedia(2),
      ]);

      for (const { name } of ESCAPED_NAMES) {
        const escaped = await convert(
          name.replace(/\.ppt$/, '.pdf'),
          options,
          blankPdf()
        );
        expect(escaped).toEqual(plain);
      }
    }
  );

  it.each([
    { name: 'Cells &amp; Tissues.ppt', deckName: 'Cells &amp; Tissues.pdf' },
    { name: 'Week <3> & 4.ppt', deckName: 'Week <3> & 4.pdf' },
    { name: '50% done.ppt', deckName: '50% done.pdf' },
  ])(
    'names the deck $deckName, as the file is named',
    async ({ name, deckName }) => {
      const decks = await prepare(name);

      expect(decks.map((deck) => deck.name)).toEqual([deckName]);
    }
  );
});
