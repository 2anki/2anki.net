import fs from 'fs';
import path from 'path';
import { extractPdfText, isChromaticRgb } from './extractPdfText';

const FIXTURES = path.join(__dirname, '../../test/fixtures');

function loadFixture(name: string): Buffer {
  return fs.readFileSync(path.join(FIXTURES, name));
}

describe('extractPdfText coloured-text detection', () => {
  it('counts a page whose text is painted with a chromatic fill', async () => {
    const result = await extractPdfText(loadFixture('pdf-colored-text.pdf'));

    expect(result.pageCount).toBe(2);
    expect(result.isDrmLocked).toBe(false);
    expect(result.coloredTextPageCount).toBe(1);
  });

  it('does not count grayscale or black text as colour', async () => {
    const result = await extractPdfText(loadFixture('pdf-plain-text.pdf'));

    expect(result.pageCount).toBe(2);
    expect(result.isDrmLocked).toBe(false);
    expect(result.coloredTextPageCount).toBe(0);
  });
});

describe('isChromaticRgb', () => {
  it('treats a strongly hued fill as chromatic', () => {
    expect(isChromaticRgb([255, 0, 0])).toBe(true);
    expect(isChromaticRgb([0, 0, 255])).toBe(true);
    expect(isChromaticRgb([255, 45, 22])).toBe(true);
  });

  it('treats black, gray, and white fills as non-chromatic', () => {
    expect(isChromaticRgb([0, 0, 0])).toBe(false);
    expect(isChromaticRgb([127, 127, 127])).toBe(false);
    expect(isChromaticRgb([255, 255, 255])).toBe(false);
  });

  it('ignores a near-neutral tint below the spread threshold', () => {
    expect(isChromaticRgb([40, 40, 55])).toBe(false);
  });

  it('returns false for malformed fill arguments', () => {
    expect(isChromaticRgb(undefined)).toBe(false);
    expect(isChromaticRgb(null)).toBe(false);
    expect(isChromaticRgb([255, 0])).toBe(false);
    expect(isChromaticRgb('red')).toBe(false);
  });
});
