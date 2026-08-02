import { synthesizeCardsFromPdf, PdfPage } from './synthesizeCardsFromPdf';

describe('synthesizeCardsFromPdf', () => {
  it('pairs consecutive pages as front/back cards', () => {
    const pages: PdfPage[] = [
      { text: 'What is mitosis?' },
      { text: 'Cell division producing two identical daughter cells.' },
      { text: 'Define meiosis.' },
      { text: 'Cell division producing four genetically unique cells.' },
    ];

    const cards = synthesizeCardsFromPdf(pages, 'Biology');

    expect(cards).toHaveLength(2);
    expect(cards[0]).toMatchObject({
      front: 'What is mitosis?',
      back: 'Cell division producing two identical daughter cells.',
    });
    expect(cards[1]).toMatchObject({
      front: 'Define meiosis.',
      back: 'Cell division producing four genetically unique cells.',
    });
  });

  it('handles odd page count by dropping the last unpaired page', () => {
    const pages: PdfPage[] = [
      { text: 'Front 1' },
      { text: 'Back 1' },
      { text: 'Orphan page — no pair' },
    ];

    const cards = synthesizeCardsFromPdf(pages, 'Test Deck');

    expect(cards).toHaveLength(1);
  });

  it('skips blank pages in a pair', () => {
    const pages: PdfPage[] = [
      { text: 'What is ATP?' },
      { text: '' },
      { text: 'What is ADP?' },
      { text: 'Adenosine diphosphate — the discharged form of ATP.' },
    ];

    const cards = synthesizeCardsFromPdf(pages, 'Biochemistry');

    expect(cards).toHaveLength(1);
    expect(cards[0].front).toBe('What is ADP?');
  });

  it('returns empty array for empty pages', () => {
    const cards = synthesizeCardsFromPdf([], 'Empty');
    expect(cards).toHaveLength(0);
  });

  it('trims whitespace from front and back text', () => {
    const pages: PdfPage[] = [
      { text: '  Front with spaces  ' },
      { text: '\n  Back with newlines\n' },
    ];

    const cards = synthesizeCardsFromPdf(pages, 'Trim Test');

    expect(cards[0].front).toBe('Front with spaces');
    expect(cards[0].back).toBe('Back with newlines');
  });

  it('uses deck name as prefix in card tags', () => {
    const pages: PdfPage[] = [{ text: 'Question?' }, { text: 'Answer.' }];

    const cards = synthesizeCardsFromPdf(pages, 'My Deck');

    expect(cards[0].tags).toContain('My_Deck');
  });
});

describe('page attribution', () => {
  it('stamps each pair card with its front page index', () => {
    const cards = synthesizeCardsFromPdf(
      [
        { text: 'Question one' },
        { text: 'Answer one' },
        { text: 'Question two' },
        { text: 'Answer two' },
      ],
      'Deck'
    );

    expect(cards.map((c) => c.pageIndex)).toEqual([0, 2]);
  });
});
