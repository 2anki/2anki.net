import { isConnectorPlanHoldEligible } from './isConnectorPlanHoldEligible';

describe('isConnectorPlanHoldEligible', () => {
  it.each([
    'deck.md',
    'notes.markdown',
    'notes.txt',
    'n5.csv',
    'n5.tsv',
    'page.html',
    'page.HTM',
  ])('saves a single %s source', (name) => {
    expect(isConnectorPlanHoldEligible([{ originalname: name }])).toBe(true);
  });

  it.each([
    'slides.pdf',
    'essay.docx',
    'vocab.xlsx',
    'lecture.pptx',
    'export.zip',
    'photo.png',
    'download',
    '.md',
  ])('keeps the refusal for %s', (name) => {
    expect(isConnectorPlanHoldEligible([{ originalname: name }])).toBe(false);
  });

  it('keeps the refusal for more than one file', () => {
    expect(
      isConnectorPlanHoldEligible([
        { originalname: 'a.md' },
        { originalname: 'b.md' },
      ])
    ).toBe(false);
  });

  it.each([[undefined], [[]]])('keeps the refusal for %j', (files) => {
    expect(isConnectorPlanHoldEligible(files)).toBe(false);
  });
});
