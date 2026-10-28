import { vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import {
  extractPdfText,
  frontShorterPairShare,
  isLandscapePage,
} from './extractPdfText';

const FIXTURES = path.join(__dirname, '../../test/fixtures');

function loadFixture(name: string): Buffer {
  return fs.readFileSync(path.join(FIXTURES, name));
}

// Same byte length, so the fixture's xref offsets stay valid.
function asLandscape(pdf: Buffer): Buffer {
  return Buffer.from(
    pdf.toString('latin1').replaceAll('[0 0 612 792]', '[0 0 792 612]'),
    'latin1'
  );
}

function withFirstPageLandscape(pdf: Buffer): Buffer {
  return Buffer.from(
    pdf.toString('latin1').replace('[0 0 612 792]', '[0 0 792 612]'),
    'latin1'
  );
}

function loggedResult(spy: ReturnType<typeof vi.spyOn>) {
  const call = spy.mock.calls.find(
    (args: unknown[]) => args[0] === '[extractPdfText] result'
  );
  return call?.[1] as Record<string, unknown>;
}

describe('isLandscapePage', () => {
  it.each([
    [[0, 0, 612, 792], 0, false],
    [[0, 0, 792, 612], 0, true],
    [[0, 0, 612, 792], 90, true],
    [[0, 0, 792, 612], 270, false],
    [[0, 0, 500, 500], 0, false],
  ])('view %j rotated %i is landscape: %s', (view, rotate, expected) => {
    expect(isLandscapePage(view, rotate)).toBe(expected);
  });

  it('treats a missing view as not landscape', () => {
    expect(isLandscapePage(undefined, 0)).toBe(false);
  });
});

describe('frontShorterPairShare', () => {
  const page = (text: string) => ({ text, imagePaintCount: 0 });

  it('is 1 when every odd page is shorter than the page after it', () => {
    expect(
      frontShorterPairShare([
        page('Q1?'),
        page('A longer answer one'),
        page('Q2?'),
        page('A longer answer two'),
      ])
    ).toBe(1);
  });

  it('is 0.5 when only one of two pairs has the shorter page first', () => {
    expect(
      frontShorterPairShare([
        page('Short'),
        page('Much longer page'),
        page('Much longer page'),
        page('Short'),
      ])
    ).toBe(0.5);
  });

  it('skips pairs where both pages are blank and is null without pairs', () => {
    expect(frontShorterPairShare([page(''), page('')])).toBeNull();
    expect(frontShorterPairShare([page('only one page')])).toBeNull();
  });
});

describe('extractPdfText layout logging', () => {
  it('logs no landscape pages for a portrait PDF', async () => {
    const spy = vi.spyOn(console, 'info').mockImplementation(() => {});
    await extractPdfText(loadFixture('pdf-plain-text.pdf'));
    expect(loggedResult(spy)).toMatchObject({ landscapePageCount: 0 });
    spy.mockRestore();
  });

  it('counts landscape pages read from the real page boxes', async () => {
    const spy = vi.spyOn(console, 'info').mockImplementation(() => {});
    const result = await extractPdfText(
      asLandscape(loadFixture('pdf-plain-text.pdf'))
    );
    expect(result.pageCount).toBe(2);
    expect(loggedResult(spy)).toMatchObject({ landscapePageCount: 2 });
    spy.mockRestore();
  });
});

describe('extractPdfText page orientation', () => {
  it('flags each page landscape or portrait from its own page box and leaves the rest of the page as it was', async () => {
    const spy = vi.spyOn(console, 'info').mockImplementation(() => {});
    const portrait = await extractPdfText(loadFixture('pdf-plain-text.pdf'));
    spy.mockClear();
    const mixed = await extractPdfText(
      withFirstPageLandscape(loadFixture('pdf-plain-text.pdf'))
    );

    expect(portrait.pages.map((page) => page.landscape)).toEqual([
      false,
      false,
    ]);
    expect(mixed.pages).toEqual([
      { ...portrait.pages[0], landscape: true },
      { ...portrait.pages[1], landscape: false },
    ]);
    expect(loggedResult(spy)).toMatchObject({ landscapePageCount: 1 });
    spy.mockRestore();
  });

  it('keeps the raster image count on the landscape page that paints it', async () => {
    const spy = vi.spyOn(console, 'info').mockImplementation(() => {});
    const result = await extractPdfText(loadFixture('pdf-landscape-image.pdf'));

    expect(result.pages).toEqual([
      {
        text: 'Cell membrane structure and function',
        imagePaintCount: 1,
        landscape: true,
      },
      {
        text: 'Transport across the membrane needs energy',
        imagePaintCount: 0,
        landscape: false,
      },
    ]);
    spy.mockRestore();
  });
});

describe('extractPdfText line order', () => {
  it('reports lines in the order the page draws them, so footer chrome drawn before the title comes first', async () => {
    const spy = vi.spyOn(console, 'info').mockImplementation(() => {});
    const result = await extractPdfText(
      loadFixture('pdf-landscape-chrome-order.pdf')
    );

    expect(result.pages.map((page) => page.text.split('\n'))).toEqual([
      [
        'Dept. of Physiology2026/10/284',
        'Membrane Proteins',
        '•Integral proteins span the bilayer',
        '•Peripheral proteins sit on one surface',
      ],
      [
        'Membrane Proteins',
        '•Integral proteins span the bilayer',
        '•Peripheral proteins sit on one surface',
        'Dept. of Physiology2026/10/284',
      ],
    ]);
    spy.mockRestore();
  });
});

describe('extractPdfText maxPages cap', () => {
  it('parses only the first page when capped, splitting over the parsed page', async () => {
    const full = await extractPdfText(loadFixture('pdf-plain-text.pdf'));
    expect(full.pages).toHaveLength(2);

    const capped = await extractPdfText(loadFixture('pdf-plain-text.pdf'), {
      maxPages: 1,
    });
    expect(capped.pages).toHaveLength(1);
    expect(capped.pages[0].text).toBe(full.pages[0].text);
  });
});
