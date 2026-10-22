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
