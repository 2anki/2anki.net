import { synthesizeCardsFromPdfHeadings } from './synthesizeCardsFromPdfHeadings';
import type { PdfPage } from './synthesizeCardsFromPdfHeadings';

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

const ORIENTATIONS: Array<[string, boolean]> = [
  ['portrait', false],
  ['landscape', true],
];

describe.each(ORIENTATIONS)('stray glyph lines (%s page)', (_o, landscape) => {
  it.each(['•', '↓', '■', '→'])(
    'keeps a glyph-only line on the back instead of making it a card front: %s',
    (glyph) => {
      const pages: PdfPage[] = [
        {
          text: [
            'Board duties',
            'Directors owe fiduciary duties of care and loyalty to the company itself.',
            glyph,
            'Why? Because a board that never delegates spends its time on details, not strategy.',
          ].join('\n'),
          landscape,
        },
      ];

      const cards = synthesizeCardsFromPdfHeadings(pages, 'Law');

      expect(cards).toHaveLength(1);
      expect(cards[0].front).toBe('Board duties');
      expect(cards[0].back).toBe(
        [
          'Directors owe fiduciary duties of care and loyalty to the company itself.',
          glyph,
          'Why? Because a board that never delegates spends its time on details, not strategy.',
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
        landscape,
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
          landscape,
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
        landscape,
      },
    ];

    const cards = synthesizeCardsFromPdfHeadings(pages, 'Bio');

    expect(cards).toHaveLength(1);
    expect(cards[0]).toMatchObject({
      front: 'Glycolysis',
      back: 'Splits glucose into two pyruvate molecules in the cytoplasm.',
    });
  });

  const fullNotesPage = [
    'Osmosis',
    'Osmosis is the net movement of water across a selectively permeable',
    'membrane from a region of lower solute concentration to a region of',
    'higher solute concentration, driven by the difference in water potential',
    'between the two sides and continuing until the potentials are equal or',
    'the pressure on the concentrated side stops any further net flow of water',
    'into the cell.',
    '•',
    'Diffusion',
    'Diffusion is the net movement of particles from a region of higher',
    'concentration to a region of lower concentration, down the gradient, as',
    'a result of their random motion; it needs no energy from the cell and',
    'its rate rises with temperature, with surface area and with how steep',
    'the gradient across the membrane is at that moment in the cell cycle and',
    'in the tissue.',
    '↓',
    'Active transport',
    'Active transport moves ions or molecules against their concentration',
    'gradient using energy released by ATP hydrolysis, through carrier proteins',
    'in the membrane that change shape as they bind and release their cargo on',
    'either side; the sodium potassium pump is the textbook example of this,',
    'moving three sodium ions out for every two potassium ions it brings back',
    'in.',
    'Endocytosis',
    'Endocytosis brings large particles into the cell by folding the membrane',
    'around them into a vesicle, as in phagocytosis by white blood cells and',
    'pinocytosis of fluid droplets, and it needs energy from ATP to bend the',
    'membrane, pinch the vesicle off and move it inwards along the filaments',
    'of the cytoskeleton towards the lysosomes that will digest what it holds',
    'inside.',
  ];
  const shortLastPage = [
    'Osmosis',
    'Movement of water across a semipermeable membrane down a gradient.',
    '•',
    'Diffusion',
    'Movement of particles from high to low concentration in a solution.',
    '↓',
    'Active transport',
    'Movement against the gradient using ATP from cellular respiration.',
  ];

  it.each([
    [
      'a full notes page with two strays',
      fullNotesPage,
      ['Osmosis', 'Diffusion', 'Active transport', 'Endocytosis'],
      ['•', '↓'],
    ],
    [
      'a short last page with two strays',
      shortLastPage,
      ['Osmosis', 'Diffusion', 'Active transport'],
      ['•', '↓'],
    ],
    [
      'a short last page with two strays that ends in an empty bullet',
      [...shortLastPage, '•'],
      ['Osmosis', 'Diffusion', 'Active transport'],
      ['•', '↓', '•'],
    ],
    [
      'a short last page with two empty bullets in a row before a heading',
      [
        'Osmosis',
        'Movement of water across a semipermeable membrane down a gradient.',
        '•',
        '•',
        'Diffusion',
        'Movement of particles from high to low concentration in a solution.',
        '↓',
        'Active transport',
        'Movement against the gradient using ATP from cellular respiration.',
      ],
      ['Osmosis', 'Diffusion', 'Active transport'],
      ['•', '•', '↓'],
    ],
  ])(
    'still opens a new card at each heading after a stray glyph on %s',
    (_shape, lines, fronts, strays) => {
      const cards = synthesizeCardsFromPdfHeadings(
        [{ text: lines.join('\n'), landscape }],
        'Bio'
      );

      expect(cards.map((card) => card.front)).toEqual(fronts);
      expect(
        cards
          .flatMap((card) => card.back.split('\n'))
          .filter((line) => line.startsWith('•') || line.startsWith('↓'))
      ).toEqual(strays);
    }
  );

  it.each(['–', '—'])(
    'keeps a lone %s divider before each heading apart from it on a page with no lone bullet glyph',
    (dash) => {
      const pages: PdfPage[] = [
        {
          text: [
            dash,
            'Osmosis',
            'Movement of water across a semipermeable membrane down a gradient.',
            dash,
            'Diffusion',
            'Movement of particles from high to low concentration in a solution.',
            dash,
            'Active transport',
            'Movement against the gradient using ATP from cellular respiration.',
          ].join('\n'),
          landscape,
        },
      ];

      const cards = synthesizeCardsFromPdfHeadings(pages, 'Bio');

      expect(cards.map(({ front, back }) => ({ front, back }))).toEqual([
        {
          front: 'Osmosis',
          back: [
            'Movement of water across a semipermeable membrane down a gradient.',
            dash,
          ].join('\n'),
        },
        {
          front: 'Diffusion',
          back: [
            'Movement of particles from high to low concentration in a solution.',
            dash,
          ].join('\n'),
        },
        {
          front: 'Active transport',
          back: 'Movement against the gradient using ATP from cellular respiration.',
        },
      ]);
    }
  );
});

describe('slide decks', () => {
  const frontsAndBacks = (pages: PdfPage[]) =>
    synthesizeCardsFromPdfHeadings(pages, 'Physiology').map(
      ({ front, back }) => ({ front, back })
    );

  it('keeps the slide titles on the front when each bullet glyph is glued to its text', () => {
    const pages: PdfPage[] = [
      {
        text: [
          'Membrane Proteins',
          '•Integral proteins span the bilayer',
          '•Peripheral proteins sit on one surface',
          '•Channels, carriers and pumps move solutes',
          '4',
        ].join('\n'),
        landscape: true,
      },
      {
        text: [
          'Types of Transport',
          '•Passive: no ATP, moves down the gradient',
          '‣Active: uses ATP, moves against the gradient',
          '▪Vesicular: endocytosis and exocytosis',
          '5',
        ].join('\n'),
        landscape: true,
      },
    ];

    expect(frontsAndBacks(pages)).toEqual([
      {
        front: 'Membrane Proteins',
        back: [
          '•Integral proteins span the bilayer',
          '•Peripheral proteins sit on one surface',
          '•Channels, carriers and pumps move solutes',
        ].join('\n'),
      },
      {
        front: 'Types of Transport',
        back: [
          '•Passive: no ATP, moves down the gradient',
          '‣Active: uses ATP, moves against the gradient',
          '▪Vesicular: endocytosis and exocytosis',
        ].join('\n'),
      },
    ]);
  });

  it.each([
    ['–', 'a space after each marker', ' '],
    ['—', 'a space after each marker', ' '],
    ['–', 'each marker glued to its text', ''],
    ['—', 'each marker glued to its text', ''],
  ])(
    'keeps a slide title on the front and its %s sub-bullets on the back, with %s',
    (dash, _gapName, gap) => {
      const pages: PdfPage[] = [
        {
          text: [
            'Learning Objectives',
            `•${gap}Describe the path of blood through the heart chambers`,
            `${dash}${gap}Explain the phases of the cardiac cycle`,
            `•${gap}Relate the ECG waves to electrical events`,
            `${dash}${gap}Calculate cardiac output from HR and SV`,
            '2',
          ].join('\n'),
          landscape: true,
        },
        {
          text: [
            'Heart Sounds',
            `•${gap}S1 lub: AV valves closing at the start of systole`,
            `${dash}${gap}Loudest at the apex`,
            `•${gap}S2 dub: semilunar valves closing as ventricles relax`,
            '3',
          ].join('\n'),
          landscape: true,
        },
      ];

      expect(frontsAndBacks(pages)).toEqual([
        {
          front: 'Learning Objectives',
          back: [
            `•${gap}Describe the path of blood through the heart chambers`,
            `${dash}${gap}Explain the phases of the cardiac cycle`,
            `•${gap}Relate the ECG waves to electrical events`,
            `${dash}${gap}Calculate cardiac output from HR and SV`,
          ].join('\n'),
        },
        {
          front: 'Heart Sounds',
          back: [
            `•${gap}S1 lub: AV valves closing at the start of systole`,
            `${dash}${gap}Loudest at the apex`,
            `•${gap}S2 dub: semilunar valves closing as ventricles relax`,
          ].join('\n'),
        },
      ]);
    }
  );

  it('rejoins bullet glyphs that sit on a line of their own with the text after them', () => {
    const pages: PdfPage[] = [
      {
        text: [
          'Learning Objectives',
          '•',
          'Describe the structure of the plasma membrane',
          '•',
          'Explain how the Na+/K+ pump sets the resting',
          'potential',
          '•',
          'Relate transport defects to disease',
          '2',
        ].join('\n'),
        landscape: true,
      },
      {
        text: [
          'Cardiac Output',
          '•',
          'CO equals heart rate times stroke volume',
          '•',
          'Normal resting value is about 5 litres per minute',
          '3',
        ].join('\n'),
        landscape: true,
      },
    ];

    expect(frontsAndBacks(pages)).toEqual([
      {
        front: 'Learning Objectives',
        back: [
          '• Describe the structure of the plasma membrane',
          '• Explain how the Na+/K+ pump sets the resting',
          'potential',
          '• Relate transport defects to disease',
        ].join('\n'),
      },
      {
        front: 'Cardiac Output',
        back: [
          '• CO equals heart rate times stroke volume',
          '• Normal resting value is about 5 litres per minute',
        ].join('\n'),
      },
    ]);
  });

  it('leaves a lone bullet with no text after it on its own line when the slide rejoins the rest', () => {
    const pages: PdfPage[] = [
      {
        text: [
          'Learning Objectives',
          '•',
          'Describe the structure of the plasma membrane',
          '•',
          '•',
          'Explain how the Na+/K+ pump sets the resting potential',
          '•',
          'Relate transport defects to disease',
          '•',
          '2',
        ].join('\n'),
        landscape: true,
      },
    ];

    expect(frontsAndBacks(pages)).toEqual([
      {
        front: 'Learning Objectives',
        back: [
          '• Describe the structure of the plasma membrane',
          '•',
          '• Explain how the Na+/K+ pump sets the resting potential',
          '• Relate transport defects to disease',
          '•',
        ].join('\n'),
      },
    ]);
  });

  it('rejoins detached bullets that make up exactly 30% of a page', () => {
    const pages: PdfPage[] = [
      {
        text: [
          'Learning Objectives',
          '•',
          'Describe the structure of the plasma membrane',
          '•',
          'Explain how the Na+/K+ pump sets the resting',
          'potential of every cell in the body at rest',
          '•',
          'Relate transport defects to disease and to',
          'the drugs that target them in the clinic',
          'today',
        ].join('\n'),
        landscape: true,
      },
    ];

    expect(frontsAndBacks(pages)).toEqual([
      {
        front: 'Learning Objectives',
        back: [
          '• Describe the structure of the plasma membrane',
          '• Explain how the Na+/K+ pump sets the resting',
          'potential of every cell in the body at rest',
          '• Relate transport defects to disease and to',
          'the drugs that target them in the clinic',
          'today',
        ].join('\n'),
      },
    ]);
  });

  it('fronts the subheading when a slide puts one under its title', () => {
    const pages: PdfPage[] = [
      {
        text: [
          'Cardiac Output',
          'Determinants and normal values',
          '•CO equals heart rate times stroke volume',
          '•Normal resting value is about 5 litres per minute',
          '3',
        ].join('\n'),
        landscape: true,
      },
    ];

    expect(frontsAndBacks(pages)).toEqual([
      {
        front: 'Determinants and normal values',
        back: [
          '•CO equals heart rate times stroke volume',
          '•Normal resting value is about 5 litres per minute',
        ].join('\n'),
      },
    ]);
  });

  it('keeps a slide whose title is longer than its first bullet on the card above, with no bullet on the front', () => {
    const pages: PdfPage[] = [
      {
        text: [
          'Cell Biology',
          'Introductory notes on the parts of the cell and what each one does.',
        ].join('\n'),
        landscape: true,
      },
      {
        text: [
          'Membrane Transport Mechanisms',
          '•Diffusion',
          '•Osmosis across the membrane',
          '•Active transport with ATP',
        ].join('\n'),
        landscape: true,
      },
    ];

    expect(frontsAndBacks(pages)).toEqual([
      {
        front: 'Cell Biology',
        back: [
          'Introductory notes on the parts of the cell and what each one does.',
          'Membrane Transport Mechanisms',
          '•Diffusion',
          '•Osmosis across the membrane',
          '•Active transport with ATP',
        ].join('\n'),
      },
    ]);
  });

  it.each(['–', '—'])(
    'rejoins %s sub-bullets that sit on a line of their own on a slide whose bullets do too',
    (dash) => {
      const pages: PdfPage[] = [
        {
          text: [
            'Learning Objectives',
            '•',
            'Describe the path of blood through the heart chambers',
            dash,
            'Explain the phases of the cardiac cycle',
            '•',
            'Relate the ECG waves to electrical events',
            dash,
            'Calculate cardiac output from HR and SV',
            '2',
          ].join('\n'),
          landscape: true,
        },
        {
          text: [
            'Heart Sounds',
            '•',
            'S1 lub: AV valves closing at the start of systole',
            dash,
            'Loudest at the apex',
            '•',
            'S2 dub: semilunar valves closing as ventricles relax',
            '3',
          ].join('\n'),
          landscape: true,
        },
      ];

      expect(frontsAndBacks(pages)).toEqual([
        {
          front: 'Learning Objectives',
          back: [
            '• Describe the path of blood through the heart chambers',
            `${dash} Explain the phases of the cardiac cycle`,
            '• Relate the ECG waves to electrical events',
            `${dash} Calculate cardiac output from HR and SV`,
          ].join('\n'),
        },
        {
          front: 'Heart Sounds',
          back: [
            '• S1 lub: AV valves closing at the start of systole',
            `${dash} Loudest at the apex`,
            '• S2 dub: semilunar valves closing as ventricles relax',
          ].join('\n'),
        },
      ]);
    }
  );

  it('fronts the bullets of a slide that draws them as shapes, since no glyph reaches the text', () => {
    const pages: PdfPage[] = [
      {
        text: [
          'Membrane Proteins',
          'Integral proteins span the bilayer',
          'Peripheral proteins sit on one surface',
          'Channels, carriers and pumps move solutes',
          '4',
        ].join('\n'),
        landscape: true,
      },
      {
        text: [
          'Types of Transport',
          'Passive: no ATP, moves down the gradient',
          'Active: uses ATP, moves against the gradient',
          'Vesicular: endocytosis and exocytosis',
          '5',
        ].join('\n'),
        landscape: true,
      },
    ];

    expect(frontsAndBacks(pages)).toEqual([
      {
        front: 'Peripheral proteins sit on one surface',
        back: 'Channels, carriers and pumps move solutes',
      },
      {
        front: 'Passive: no ATP, moves down the gradient',
        back: [
          'Active: uses ATP, moves against the gradient',
          'Vesicular: endocytosis and exocytosis',
        ].join('\n'),
      },
    ]);
  });

  const symbolFontBullets = [
    ['U+F0B7 (Symbol bullet)', '\uF0B7'],
    ['U+F0A7 (Wingdings square)', '\uF0A7'],
    ['U+F0D8 (Wingdings arrowhead)', '\uF0D8'],
    ['U+F0FC (Wingdings check mark)', '\uF0FC'],
    ['U+F076 (Wingdings diamond)', '\uF076'],
    ['➢', '➢'],
    ['➤', '➤'],
    ['❖', '❖'],
    ['♦', '♦'],
  ];

  it.each(symbolFontBullets)(
    'keeps the slide title on the front when a %s bullet is glued to its text',
    (_name, glyph) => {
      const pages: PdfPage[] = [
        {
          text: [
            'Membrane Proteins',
            `${glyph}Integral proteins span the bilayer`,
            `${glyph}Peripheral proteins sit on one surface`,
            `${glyph}Channels, carriers and pumps move solutes`,
          ].join('\n'),
          landscape: true,
        },
      ];

      expect(frontsAndBacks(pages)).toEqual([
        {
          front: 'Membrane Proteins',
          back: [
            `${glyph}Integral proteins span the bilayer`,
            `${glyph}Peripheral proteins sit on one surface`,
            `${glyph}Channels, carriers and pumps move solutes`,
          ].join('\n'),
        },
      ]);
    }
  );

  it.each(symbolFontBullets)(
    'rejoins a %s bullet that sits on a line of its own with the text after it',
    (_name, glyph) => {
      const pages: PdfPage[] = [
        {
          text: [
            'Cardiac Output',
            glyph,
            'CO equals heart rate times stroke volume',
            glyph,
            'Normal resting value is about 5 litres per minute',
          ].join('\n'),
          landscape: true,
        },
      ];

      expect(frontsAndBacks(pages)).toEqual([
        {
          front: 'Cardiac Output',
          back: [
            `${glyph} CO equals heart rate times stroke volume`,
            `${glyph} Normal resting value is about 5 litres per minute`,
          ].join('\n'),
        },
      ]);
    }
  );

  it('makes no card from a page of glued bullets with no heading above them', () => {
    const pages: PdfPage[] = [
      {
        text: [
          '•Short bullet',
          '•A noticeably longer bullet line follows the short one',
          '•Another bullet',
        ].join('\n'),
        landscape: true,
      },
    ];

    expect(synthesizeCardsFromPdfHeadings(pages, 'Notes')).toEqual([]);
  });

  it.each([
    [
      '-70 mV',
      'Typical resting membrane potential of a neuron, set by K+ leak channels.',
    ],
    [
      '–70 mV',
      'Typical resting membrane potential of a neuron, set by K+ leak channels.',
    ],
    [
      '-itis',
      'Suffix for inflammation of an organ, as in appendicitis or otitis.',
    ],
  ])(
    'still reads %s as a heading: a dash before a digit, or a hyphen, opens a list item only with a space after it',
    (heading, body) => {
      const pages: PdfPage[] = [
        { text: `${heading}\n${body}`, landscape: true },
      ];

      expect(frontsAndBacks(pages)).toEqual([{ front: heading, back: body }]);
    }
  );

  it.each([
    '■細胞の構造',
    '■タンパク質の合成',
    '■ふりかえり',
    '■세포의 구조',
    '■DNAの構造',
    '■iPS細胞',
    '■ATP合成酵素',
    '■2型糖尿病',
    '■ＤＮＡの複製',
    '■（1）細胞周期',
    '■「恒常性」とは',
    '●T細胞の働き',
    '■【まとめ】',
    '◆【第1回】細胞生物学',
    '■＜到達目標＞',
    '■DNA 복제',
    '■DNA的结构',
    '■ＤＮＡ',
    '■ＡＴＰ',
    '■（１）',
    '■【Point】',
    '■【Check】',
    '■Ｑ＆Ａ',
    '◆ＰＣＲ',
  ])('keeps a CJK slide title glued to its glyph on the front: %s', (title) => {
    const pages: PdfPage[] = [
      {
        text: [
          title,
          '• 細胞膜はリン脂質の二重層でできている',
          '• 核は遺伝情報を保持している',
          '4',
        ].join('\n'),
        landscape: true,
      },
    ];

    expect(frontsAndBacks(pages)).toEqual([
      {
        front: title,
        back: [
          '• 細胞膜はリン脂質の二重層でできている',
          '• 核は遺伝情報を保持している',
        ].join('\n'),
      },
    ]);
  });

  it.each(['■ATP', '■Q&A'])(
    'reads a plain-ASCII %s on a Latin slide as a glued bullet, so it stays on the card above',
    (title) => {
      const pages: PdfPage[] = [
        {
          text: [
            'Energy Metabolism',
            '•Cells turn glucose into usable energy',
            '•Most of it is made in the mitochondria',
            '4',
          ].join('\n'),
          landscape: true,
        },
        {
          text: [
            title,
            '•Made by ATP synthase in the inner membrane',
            '•Powers pumps, motors and biosynthesis',
            '5',
          ].join('\n'),
          landscape: true,
        },
      ];

      expect(frontsAndBacks(pages)).toEqual([
        {
          front: 'Energy Metabolism',
          back: [
            '•Cells turn glucose into usable energy',
            '•Most of it is made in the mitochondria',
            title,
            '•Made by ATP synthase in the inner membrane',
            '•Powers pumps, motors and biosynthesis',
          ].join('\n'),
        },
      ]);
    }
  );

  it('leaves a lone bullet that ends a slide on that slide, apart from the next slide title', () => {
    const pages: PdfPage[] = [
      {
        text: [
          'Learning Objectives',
          '•',
          'Describe the structure of the plasma membrane',
          '•',
          'Explain how the Na+/K+ pump sets the resting potential',
          '•',
          '2',
        ].join('\n'),
        landscape: true,
      },
      {
        text: [
          'Cardiac Output',
          '•',
          'CO equals heart rate times stroke volume',
          '•',
          'Normal resting value is about 5 litres per minute',
          '3',
        ].join('\n'),
        landscape: true,
      },
    ];

    expect(frontsAndBacks(pages)).toEqual([
      {
        front: 'Learning Objectives',
        back: [
          '• Describe the structure of the plasma membrane',
          '• Explain how the Na+/K+ pump sets the resting potential',
          '•',
        ].join('\n'),
      },
      {
        front: 'Cardiac Output',
        back: [
          '• CO equals heart rate times stroke volume',
          '• Normal resting value is about 5 litres per minute',
        ].join('\n'),
      },
    ]);
  });
});

describe('PDFs with a page that is not landscape', () => {
  const portraitPage = (lines: string[]): PdfPage => ({
    text: lines.join('\n'),
    landscape: false,
  });
  const wordOutline = [
    '\uF0B7Cell structure',
    'oThe plasma membrane is a phospholipid bilayer with proteins',
    'oThe nucleus holds the genome inside a double membrane',
    '\uF0B7Membrane transport',
    'oDiffusion moves particles down a concentration gradient',
    'oActive transport uses ATP to move ions against it',
    '\uF0B7Cell division',
    'oMitosis makes two identical daughter cells for growth',
    'oMeiosis makes four gametes with half the chromosomes',
    '1',
  ];
  const loneBulletBeforeEachHeading = [
    '•',
    'Osmosis',
    'Movement of water across a semipermeable membrane down a gradient.',
    '•',
    'Diffusion',
    'Movement of particles from high to low concentration in a solution.',
    '•',
    'Active transport',
    'Movement against the gradient using ATP from cellular respiration.',
  ];
  const cardsUnderLoneBullets = [
    {
      front: 'Osmosis',
      back: 'Movement of water across a semipermeable membrane down a gradient.\n•',
      tags: ['Bio'],
      pageIndex: 0,
    },
    {
      front: 'Diffusion',
      back: 'Movement of particles from high to low concentration in a solution.\n•',
      tags: ['Bio'],
      pageIndex: 0,
    },
    {
      front: 'Active transport',
      back: 'Movement against the gradient using ATP from cellular respiration.',
      tags: ['Bio'],
      pageIndex: 0,
    },
  ];

  it('keeps each topic of a Word outline on the front when its Symbol bullet is glued to it', () => {
    expect(
      synthesizeCardsFromPdfHeadings([portraitPage(wordOutline)], 'Biology')
    ).toEqual([
      {
        front: '\uF0B7Cell structure',
        back: 'oThe plasma membrane is a phospholipid bilayer with proteins\noThe nucleus holds the genome inside a double membrane',
        tags: ['Biology'],
        pageIndex: 0,
      },
      {
        front: '\uF0B7Membrane transport',
        back: 'oDiffusion moves particles down a concentration gradient\noActive transport uses ATP to move ions against it',
        tags: ['Biology'],
        pageIndex: 0,
      },
      {
        front: '\uF0B7Cell division',
        back: 'oMitosis makes two identical daughter cells for growth\noMeiosis makes four gametes with half the chromosomes',
        tags: ['Biology'],
        pageIndex: 0,
      },
    ]);
  });

  it('reads a bullet glued to its text as an ordinary line, so a short one over a longer one fronts a card', () => {
    const notes = [
      'Osmosis',
      '•Passive',
      '•Water crosses a semipermeable membrane toward the side with more solute',
      '•Stops when the water potentials on both sides are equal',
      'Diffusion',
      '•Particles spread from high to low concentration',
      '•Needs no energy from the cell',
    ];

    expect(
      synthesizeCardsFromPdfHeadings([portraitPage(notes)], 'Biology')
    ).toEqual([
      {
        front: '•Passive',
        back: '•Water crosses a semipermeable membrane toward the side with more solute\n•Stops when the water potentials on both sides are equal',
        tags: ['Biology'],
        pageIndex: 0,
      },
      {
        front: 'Diffusion',
        back: '•Particles spread from high to low concentration\n•Needs no energy from the cell',
        tags: ['Biology'],
        pageIndex: 0,
      },
    ]);
  });

  it('keeps each CJK heading glued to its ■ on the front', () => {
    const notes = [
      '■細胞の構造',
      '細胞膜はリン脂質の二重層で、膜タンパク質が物質の出入りを調節する。',
      '核は遺伝情報を保持し、二重の核膜で囲まれている。',
      '■物質の輸送',
      '拡散は濃度の高い方から低い方へ、エネルギーを使わずに物質が移動する現象である。',
      '能動輸送はATPのエネルギーを使い、濃度勾配に逆らって物質を運ぶ。',
      '■細胞分裂',
      '体細胞分裂では、遺伝的に同一の二つの娘細胞ができる。',
    ];

    expect(
      synthesizeCardsFromPdfHeadings([portraitPage(notes)], 'Biology')
    ).toEqual([
      {
        front: '■細胞の構造',
        back: '細胞膜はリン脂質の二重層で、膜タンパク質が物質の出入りを調節する。\n核は遺伝情報を保持し、二重の核膜で囲まれている。',
        tags: ['Biology'],
        pageIndex: 0,
      },
      {
        front: '■物質の輸送',
        back: '拡散は濃度の高い方から低い方へ、エネルギーを使わずに物質が移動する現象である。\n能動輸送はATPのエネルギーを使い、濃度勾配に逆らって物質を運ぶ。',
        tags: ['Biology'],
        pageIndex: 0,
      },
      {
        front: '■細胞分裂',
        back: '体細胞分裂では、遺伝的に同一の二つの娘細胞ができる。',
        tags: ['Biology'],
        pageIndex: 0,
      },
    ]);
  });

  it('keeps a lone bullet before each heading on the card above, and each heading on the front', () => {
    expect(
      synthesizeCardsFromPdfHeadings(
        [portraitPage(loneBulletBeforeEachHeading)],
        'Bio'
      )
    ).toEqual(cardsUnderLoneBullets);
  });

  it('fronts the first of a page of glued bullets with no heading above them', () => {
    const bullets = [
      '•Short bullet',
      '•A noticeably longer bullet line follows the short one',
      '•Another bullet',
    ];

    expect(
      synthesizeCardsFromPdfHeadings([portraitPage(bullets)], 'Notes')
    ).toEqual([
      {
        front: '•Short bullet',
        back: '•A noticeably longer bullet line follows the short one\n•Another bullet',
        tags: ['Notes'],
        pageIndex: 0,
      },
    ]);
  });

  it('reads a page with no orientation flag as a portrait page', () => {
    expect(
      synthesizeCardsFromPdfHeadings(
        [{ text: loneBulletBeforeEachHeading.join('\n') }],
        'Bio'
      )
    ).toEqual(cardsUnderLoneBullets);
  });

  it.each([
    ['flagged portrait', false],
    ['with no flag', undefined],
  ])(
    'keeps a slide between two pages %s from changing the cards around it',
    (_flag, otherPages) => {
      const pages: PdfPage[] = [
        {
          text: [
            'Course overview',
            'This course covers the human body from the cell up to whole organ systems.',
          ].join('\n'),
          landscape: otherPages,
        },
        {
          text: [
            'Course schedule',
            '•',
            'Week 1 introduction to cells',
            '•',
            'Week 2 tissue types',
          ].join('\n'),
          landscape: true,
        },
        {
          text: [
            'Week 3 organs',
            'Week 4 organ systems',
            'Week 5 homeostasis loops',
            'Reading list for the whole term is posted on the course page.',
          ].join('\n'),
          landscape: otherPages,
        },
      ];

      expect(synthesizeCardsFromPdfHeadings(pages, 'Course')).toEqual([
        {
          front: 'Course overview',
          back: [
            'This course covers the human body from the cell up to whole organ systems.',
            'Course schedule',
            '•',
            'Week 1 introduction to cells',
            '•',
            'Week 2 tissue types',
            'Week 3 organs',
            'Week 4 organ systems',
          ].join('\n'),
          tags: ['Course'],
          pageIndex: 0,
        },
        {
          front: 'Week 5 homeostasis loops',
          back: 'Reading list for the whole term is posted on the course page.',
          tags: ['Course'],
          pageIndex: 2,
        },
      ]);
    }
  );

  it('keeps a slide before a portrait page from changing the cards after it', () => {
    const pages: PdfPage[] = [
      {
        text: [
          'Overview',
          '•',
          'First point about the topic',
          '•',
          'Second point covers how these parts connect to one another',
        ].join('\n'),
        landscape: true,
      },
      {
        text: [
          'Step one',
          'Step two of the process',
          'Mix the dry ingredients in a large bowl',
          'Stir well',
        ].join('\n'),
        landscape: false,
      },
    ];

    expect(synthesizeCardsFromPdfHeadings(pages, 'Notes')).toEqual([
      {
        front: 'Step two of the process',
        back: 'Mix the dry ingredients in a large bowl\nStir well',
        tags: ['Notes'],
        pageIndex: 1,
      },
    ]);
  });
});
