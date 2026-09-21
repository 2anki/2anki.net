import { isPartialDeliveryEligible } from './isPartialDeliveryEligible';

const file = (originalname: string) => ({ originalname });

describe('isPartialDeliveryEligible', () => {
  it.each([
    'notes.html',
    'notes.md',
    'notes.txt',
    'notes.csv',
    'notes.pdf',
    'notes.docx',
    'notes.xlsx',
    'slides.pptx',
    'slides.ppt',
  ])('accepts a single %s upload', (name) => {
    expect(isPartialDeliveryEligible([file(name)])).toBe(true);
  });

  it.each(['notes.zip', 'notes.xml', 'notes.epub', 'notes.opml', 'deck.apkg'])(
    'rejects a single %s upload',
    (name) => {
      expect(isPartialDeliveryEligible([file(name)])).toBe(false);
    }
  );

  it('rejects a multi-file upload', () => {
    expect(
      isPartialDeliveryEligible([file('one.html'), file('two.html')])
    ).toBe(false);
  });

  it('rejects an upload with no files', () => {
    expect(isPartialDeliveryEligible([])).toBe(false);
    expect(isPartialDeliveryEligible(undefined)).toBe(false);
  });
});
