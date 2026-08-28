import { synthesizeCardsFromPdfHeadings } from './synthesizeCardsFromPdfHeadings';
import type { PdfPage } from './synthesizeCardsFromPdf';

describe('synthesizeCardsFromPdfHeadings', () => {
  it('starts a new card at a short line followed by longer body text', () => {
    const pages: PdfPage[] = [
      {
        text: [
          'What is mitosis?',
          'Cell division producing two genetically identical daughter cells.',
          'What is meiosis?',
          'Cell division producing four genetically unique daughter cells.',
        ].join('\n'),
      },
    ];

    const cards = synthesizeCardsFromPdfHeadings(pages, 'Biology');

    expect(cards).toHaveLength(2);
    expect(cards[0]).toMatchObject({
      front: 'What is mitosis?',
      back: 'Cell division producing two genetically identical daughter cells.',
    });
    expect(cards[1]).toMatchObject({
      front: 'What is meiosis?',
      back: 'Cell division producing four genetically unique daughter cells.',
    });
  });

  it('joins multiple body lines under one heading', () => {
    const pages: PdfPage[] = [
      {
        text: [
          'Photosynthesis',
          'Light-dependent reactions happen in the thylakoid membrane first.',
          'The Calvin cycle then fixes carbon dioxide in the stroma afterwards.',
        ].join('\n'),
      },
    ];

    const cards = synthesizeCardsFromPdfHeadings(pages, 'Bio');

    expect(cards).toHaveLength(1);
    expect(cards[0].back).toBe(
      [
        'Light-dependent reactions happen in the thylakoid membrane first.',
        'The Calvin cycle then fixes carbon dioxide in the stroma afterwards.',
      ].join('\n')
    );
  });

  it('treats a 59-character line as a heading and a 60-character line as body', () => {
    const heading59 = 'H'.repeat(59);
    const line60 = 'B'.repeat(60);
    const body = 'C'.repeat(80);
    const pages: PdfPage[] = [{ text: [heading59, line60, body].join('\n') }];

    const cards = synthesizeCardsFromPdfHeadings(pages, 'Edge');

    expect(cards).toHaveLength(1);
    expect(cards[0].front).toBe(heading59);
    expect(cards[0].back).toBe([line60, body].join('\n'));
  });

  it('drops a heading immediately followed by another heading', () => {
    const pages: PdfPage[] = [
      {
        text: [
          'Chapter 4',
          'Krebs cycle',
          'A series of reactions releasing stored energy in mitochondria.',
        ].join('\n'),
      },
    ];

    const cards = synthesizeCardsFromPdfHeadings(pages, 'Bio');

    expect(cards).toHaveLength(1);
    expect(cards[0].front).toBe('Krebs cycle');
  });

  it('drops body text that appears before the first heading', () => {
    const pages: PdfPage[] = [
      {
        text: [
          'Some long preamble paragraph that belongs to no heading at all here.',
          'Glycolysis',
          'Splits glucose into two pyruvate molecules in the cytoplasm.',
        ].join('\n'),
      },
    ];

    const cards = synthesizeCardsFromPdfHeadings(pages, 'Bio');

    expect(cards).toHaveLength(1);
    expect(cards[0].front).toBe('Glycolysis');
  });

  it('carries a card across a page boundary', () => {
    const pages: PdfPage[] = [
      { text: 'Cell membrane' },
      {
        text: 'A phospholipid bilayer controlling what enters and exits the cell.',
      },
    ];

    const cards = synthesizeCardsFromPdfHeadings(pages, 'Bio');

    expect(cards).toHaveLength(1);
    expect(cards[0].front).toBe('Cell membrane');
  });

  it('tags every card with the underscored deck name', () => {
    const pages: PdfPage[] = [
      {
        text: [
          'Osmosis',
          'Movement of water across a semipermeable membrane down a gradient.',
        ].join('\n'),
      },
    ];

    const cards = synthesizeCardsFromPdfHeadings(pages, 'Cell Biology 101');

    expect(cards[0].tags).toEqual(['Cell_Biology_101']);
  });

  it('returns an empty array for blank pages', () => {
    expect(
      synthesizeCardsFromPdfHeadings([{ text: '' }, { text: '  \n ' }], 'Empty')
    ).toEqual([]);
  });

  it('returns an empty array when no line qualifies as a heading', () => {
    const longLine =
      'Every single line in this document is a long flowing paragraph well over the limit.';
    const pages: PdfPage[] = [{ text: [longLine, longLine].join('\n') }];

    expect(synthesizeCardsFromPdfHeadings(pages, 'NoHeadings')).toEqual([]);
  });

  it('does not promote the wrapped tail of a bullet to a card front', () => {
    const pages: PdfPage[] = [
      {
        text: [
          'Contract remedies overview',
          'Parties should always attempt to resolve their disagreements before disputes',
          'arise.',
          'The tribunal has broad discretion to order interim measures where truly',
          'necessary.',
        ].join('\n'),
      },
    ];

    const cards = synthesizeCardsFromPdfHeadings(pages, 'Law');

    expect(cards).toHaveLength(1);
    expect(cards[0].front).toBe('Contract remedies overview');
    expect(cards[0].back).toContain('arise.');
    expect(cards[0].back).toContain('necessary.');
  });

  it.each(['Cells rest.', 'Cells rest,', 'Cells rest;'])(
    'does not treat a short line ending in sentence punctuation as a heading: %s',
    (line) => {
      const pages: PdfPage[] = [
        {
          text: [
            line,
            'The interphase period occupies most of the cell cycle timeline overall.',
          ].join('\n'),
        },
      ];

      expect(synthesizeCardsFromPdfHeadings(pages, 'Bio')).toEqual([]);
    }
  );

  it('still treats a colon-ending short line as a heading', () => {
    const pages: PdfPage[] = [
      {
        text: [
          'Key enzymes:',
          'Helicase unwinds the double helix ahead of the replication fork machinery.',
        ].join('\n'),
      },
    ];

    const cards = synthesizeCardsFromPdfHeadings(pages, 'Bio');

    expect(cards).toHaveLength(1);
    expect(cards[0].front).toBe('Key enzymes:');
  });

  it.each([
    '• Contract basics',
    '- Contract basics',
    '* Contract basics',
    '1. Contract basics',
    '2) Contract basics',
  ])('does not treat a list-marker line as a heading: %s', (line) => {
    const pages: PdfPage[] = [
      {
        text: [
          line,
          'Formation requires offer and acceptance plus consideration between parties.',
        ].join('\n'),
      },
    ];

    expect(synthesizeCardsFromPdfHeadings(pages, 'Law')).toEqual([]);
  });

  it('does not treat a lowercase-starting line as a heading', () => {
    const pages: PdfPage[] = [
      {
        text: [
          'arise when parties fail to agree on the terms',
          'Litigation costs then escalate quickly beyond initial expectations for everyone.',
        ].join('\n'),
      },
    ];

    expect(synthesizeCardsFromPdfHeadings(pages, 'Law')).toEqual([]);
  });

  it('does not promote a continuation of a wrapped unpunctuated line to a card front', () => {
    const pages: PdfPage[] = [
      {
        text: [
          'Judges consider precedent alongside statutory interpretation and policy',
          'General Deterrence',
          'Fines and sanctions reduce socially harmful conduct through expected costs.',
        ].join('\n'),
      },
    ];

    expect(synthesizeCardsFromPdfHeadings(pages, 'Law')).toEqual([]);
  });

  it('drops a page-number footer and rejoins the bullets after the page break to the heading above', () => {
    const pages: PdfPage[] = [
      {
        text: [
          '2)Coordination costs',
          '• Large firms involve many participants.',
          '1',
        ].join('\n'),
      },
      {
        text: [
          '• Decision-making therefore becomes difficult.',
          '• One legal solution is: Majority rule.',
          '• Corporate law therefore creates voting rules that reduce coordination costs.',
          '2',
        ].join('\n'),
      },
    ];

    const cards = synthesizeCardsFromPdfHeadings(pages, 'Law');

    expect(cards).toHaveLength(1);
    expect(cards[0].front).toBe('2)Coordination costs');
    expect(cards[0].back).toBe(
      [
        '• Large firms involve many participants.',
        '• Decision-making therefore becomes difficult.',
        '• One legal solution is: Majority rule.',
        '• Corporate law therefore creates voting rules that reduce coordination costs.',
      ].join('\n')
    );
  });

  it.each(['35', 'Page 3', '3 / 35', '3 of 35', '- 12 -'])(
    'drops a page footer from both the front and the back: %s',
    (footer) => {
      const pages: PdfPage[] = [
        {
          text: [
            'Contract formation',
            'Formation requires offer and acceptance plus consideration between parties.',
            footer,
            'Consideration must move from the promisee but need not be adequate in value.',
          ].join('\n'),
        },
      ];

      const cards = synthesizeCardsFromPdfHeadings(pages, 'Law');

      expect(cards).toHaveLength(1);
      expect(cards[0].back).toBe(
        [
          'Formation requires offer and acceptance plus consideration between parties.',
          'Consideration must move from the promisee but need not be adequate in value.',
        ].join('\n')
      );
    }
  );

  it('keeps a bare four-digit year as a card front', () => {
    const pages: PdfPage[] = [
      {
        text: [
          'Timeline',
          '1914',
          'War begins after the assassination in Sarajevo triggers the alliances.',
          '1918',
          'Armistice signed in a railway carriage at Compiègne in November.',
        ].join('\n'),
      },
    ];

    const cards = synthesizeCardsFromPdfHeadings(pages, 'History');

    expect(cards.map((card) => card.front)).toEqual(['1914', '1918']);
  });

  it('keeps a run of short sibling lines under the heading above (a checklist with its glyphs stripped)', () => {
    const items = [
      'Classes 1-2: Theory & Introduction',
      'Classes 3-4: Boards of Directors',
      'Classes 5-6: Shareholders and Institutional Investors',
      'Class 7: Related Party Transactions',
      'Class 8: Creditor Protection',
      'Class 9: Employees in Corporate Governance',
      'Class 10: Agency Capitalism, equity markets and takeovers',
      'Class 11: Lawmaking and Regulatory Competition',
      'Class 12: Exam',
    ];
    const pages: PdfPage[] = [{ text: ['Teaching plan', ...items].join('\n') }];

    const cards = synthesizeCardsFromPdfHeadings(pages, 'Law');

    expect(cards).toHaveLength(1);
    expect(cards[0].front).toBe('Teaching plan');
    expect(cards[0].back).toBe(items.join('\n'));
  });

  it('keeps a heading that follows a terse unpunctuated one-line body', () => {
    const pages: PdfPage[] = [
      {
        text: [
          'Osmosis',
          'Water movement across a membrane',
          'Diffusion',
          'Movement of particles from high to low concentration in a solution.',
        ].join('\n'),
      },
    ];

    const cards = synthesizeCardsFromPdfHeadings(pages, 'Bio');

    expect(cards).toHaveLength(2);
    expect(cards[0]).toMatchObject({
      front: 'Osmosis',
      back: 'Water movement across a membrane',
    });
    expect(cards[1].front).toBe('Diffusion');
  });

  it('keeps the first heading after short title-page lines', () => {
    const pages: PdfPage[] = [
      {
        text: [
          'Corporate Governance',
          'Lecture 3',
          'Agency costs',
          'Managers may pursue their own interests at shareholder expense over time.',
          'Board duties',
          'Directors owe fiduciary duties of care and loyalty to the company itself.',
        ].join('\n'),
      },
    ];

    const cards = synthesizeCardsFromPdfHeadings(pages, 'Law');

    expect(cards.map((card) => card.front)).toEqual([
      'Agency costs',
      'Board duties',
    ]);
  });

  it.each([
    '☐ Class 7: Related Party Transactions',
    '☑ Classes 1-2: Theory & Introduction',
    '✓ Class 8: Creditor Protection',
  ])('does not treat a checkbox line as a heading: %s', (line) => {
    const pages: PdfPage[] = [
      {
        text: [
          line,
          'Formation requires offer and acceptance plus consideration between parties.',
        ].join('\n'),
      },
    ];

    expect(synthesizeCardsFromPdfHeadings(pages, 'Law')).toEqual([]);
  });

  it('treats a heading after a sentence-terminated line as a heading', () => {
    const pages: PdfPage[] = [
      {
        text: [
          'Most negligence claims settle well before any court date is scheduled.',
          'General Deterrence',
          'Fines and sanctions reduce socially harmful conduct through expected costs.',
        ].join('\n'),
      },
    ];

    const cards = synthesizeCardsFromPdfHeadings(pages, 'Law');

    expect(cards).toHaveLength(1);
    expect(cards[0].front).toBe('General Deterrence');
  });
});

describe('page attribution', () => {
  it('stamps each card with the page its heading came from', () => {
    const cards = synthesizeCardsFromPdfHeadings(
      [
        {
          text: 'First Topic\nBody line about the first topic goes on and on here.',
        },
        {
          text: 'Second Topic\nBody line about the second topic goes on and on too.',
        },
      ],
      'Deck'
    );

    expect(cards).toHaveLength(2);
    expect(cards[0].pageIndex).toBe(0);
    expect(cards[1].pageIndex).toBe(1);
  });

  it('keeps the heading page when the body spills onto the next page', () => {
    const cards = synthesizeCardsFromPdfHeadings(
      [
        {
          text: 'Spilling Topic\nThe body starts on the first page with plenty of text.',
        },
        { text: 'And continues onto the second page without a new heading.' },
      ],
      'Deck'
    );

    expect(cards).toHaveLength(1);
    expect(cards[0].pageIndex).toBe(0);
  });
});

describe('stray glyph lines', () => {
  it.each(['•', '↓', '■', '→'])(
    'keeps a glyph-only line on the back instead of making it a card front: %s',
    (glyph) => {
      const pages: PdfPage[] = [
        {
          text: [
            'Board duties',
            'Directors owe fiduciary duties of care and loyalty to the company itself.',
            glyph,
            'Why? Because principals would spend too much on preventing any appearance of authority.',
          ].join('\n'),
        },
      ];

      const cards = synthesizeCardsFromPdfHeadings(pages, 'Law');

      expect(cards).toHaveLength(1);
      expect(cards[0].front).toBe('Board duties');
      expect(cards[0].back).toBe(
        [
          'Directors owe fiduciary duties of care and loyalty to the company itself.',
          glyph,
          'Why? Because principals would spend too much on preventing any appearance of authority.',
        ].join('\n')
      );
    }
  );

  it('still opens a new card at the heading that follows a glyph-only line', () => {
    const pages: PdfPage[] = [
      {
        text: [
          'Osmosis',
          'Movement of water across a semipermeable membrane down a gradient.',
          '•',
          'Diffusion',
          'Movement of particles from high to low concentration in a solution.',
        ].join('\n'),
      },
    ];

    const cards = synthesizeCardsFromPdfHeadings(pages, 'Bio');

    expect(cards.map((card) => card.front)).toEqual(['Osmosis', 'Diffusion']);
    expect(cards[0].back).toBe(
      [
        'Movement of water across a semipermeable membrane down a gradient.',
        '•',
      ].join('\n')
    );
  });

  it.each(['■ Examples: …', '→ Key takeaways', '▶ Watch the lecture'])(
    'does not treat a line opened by a shape or arrow marker as a heading: %s',
    (line) => {
      const pages: PdfPage[] = [
        {
          text: [
            line,
            'Formation requires offer and acceptance plus consideration between parties.',
          ].join('\n'),
        },
      ];

      expect(synthesizeCardsFromPdfHeadings(pages, 'Law')).toEqual([]);
    }
  );

  it('discards a glyph-only line that appears before the first heading', () => {
    const pages: PdfPage[] = [
      {
        text: [
          '•',
          'Glycolysis',
          'Splits glucose into two pyruvate molecules in the cytoplasm.',
        ].join('\n'),
      },
    ];

    const cards = synthesizeCardsFromPdfHeadings(pages, 'Bio');

    expect(cards).toHaveLength(1);
    expect(cards[0]).toMatchObject({
      front: 'Glycolysis',
      back: 'Splits glucose into two pyruvate molecules in the cytoplasm.',
    });
  });
});
