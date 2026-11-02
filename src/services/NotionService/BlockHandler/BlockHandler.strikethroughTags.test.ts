import { vi } from 'vitest';
import BlockHandler from './BlockHandler';
import CardOption from '../../../lib/parser/Settings/CardOption';
import CustomExporter from '../../../lib/parser/exporters/CustomExporter';
import ParserRules from '../../../lib/parser/ParserRules';
import Workspace from '../../../lib/parser/WorkSpace';
import NotionAPIWrapper from '../NotionAPIWrapper';
import { setupTests } from '../../../test/configure-jest';
import type { RescueRule } from '../../../types/RescueCandidate';
import { BlockObjectResponse } from '@notionhq/client/build/src/api-endpoints';
import { blockToStaticMarkup } from '../helpers/blockToStaticMarkup';

beforeEach(() => setupTests());

function richText(content: string, strikethrough = false) {
  return {
    type: 'text' as const,
    text: { content, link: null },
    annotations: {
      bold: false,
      italic: false,
      strikethrough,
      underline: false,
      code: false,
      color: 'default' as const,
    },
    plain_text: content,
    href: null,
  };
}

const struck = (content: string) => richText(content, true);

function block(
  id: string,
  type: string,
  rich: ReturnType<typeof richText>[],
  hasChildren = false
) {
  return {
    object: 'block',
    id,
    parent: { type: 'page_id', page_id: 'page-1' },
    created_time: '',
    last_edited_time: '',
    created_by: { object: 'user', id: 'u' },
    last_edited_by: { object: 'user', id: 'u' },
    has_children: hasChildren,
    archived: false,
    in_trash: false,
    type,
    [type]: { rich_text: rich, color: 'default' },
  };
}

function blockList(results: unknown[]) {
  return {
    object: 'list',
    results,
    next_cursor: null,
    has_more: false,
    type: 'block',
    block: {},
  };
}

function makeApi(childrenById: Record<string, unknown[]>): NotionAPIWrapper {
  return {
    getPage: vi.fn().mockResolvedValue({
      id: 'page-1',
      object: 'page',
      created_time: '',
      last_edited_time: '',
    }),
    getPageTitle: vi.fn().mockResolvedValue('Physiology'),
    getTopLevelTags: vi.fn().mockResolvedValue([]),
    getBlocks: vi
      .fn()
      .mockImplementation(({ id }: { id: string }) =>
        Promise.resolve(blockList(childrenById[id] ?? []))
      ),
  } as unknown as NotionAPIWrapper;
}

function headingRules(): ParserRules {
  const rules = new ParserRules();
  rules.TAGS = 'heading';
  return rules;
}

async function convert(
  settings: CardOption,
  childrenById: Record<string, unknown[]> = page,
  options: { rules?: ParserRules; rescueRule?: RescueRule } = {}
) {
  const handler = new BlockHandler(
    new CustomExporter('', new Workspace(true, 'fs').location),
    makeApi(childrenById),
    settings
  );
  const decks = await handler.findFlashcards({
    parentType: 'page' as const,
    topLevelId: 'page-1',
    rules: options.rules ?? new ParserRules(),
    decks: [],
    parentName: '',
    rescueRule: options.rescueRule,
  });
  return decks.flatMap((deck) => deck.cards);
}

const page = {
  'page-1': [
    block('t-1', 'toggle', [richText('What lowers FRC?')], true),
    block(
      't-2',
      'toggle',
      [richText('What are the lung volumes? '), struck('2001')],
      true
    ),
  ],
  't-1': [
    block('p-1', 'paragraph', [richText('Supine posture')]),
    block('p-2', 'paragraph', [
      struck('2025'),
      richText(' '),
      struck('2004'),
      richText(' '),
      struck('2001'),
    ]),
  ],
  't-2': [block('p-3', 'paragraph', [richText('Four volumes')])],
};

describe('strikethrough tags on a connected Notion page', () => {
  it('turns struck text on the answer into tags and leaves it off the card', async () => {
    const [card] = await convert(new CardOption({}));

    expect(card.tags).toEqual(['2025', '2004', '2001']);
    expect(card.back).toContain('Supine posture');
    expect(card.back).not.toContain('<del>');
    expect(card.back).not.toMatch(/2025|2004|2001/);
  });

  it('turns struck text on the question into a tag and leaves it off the front', async () => {
    const [, card] = await convert(new CardOption({}));

    expect(card.tags).toEqual(['2001']);
    expect(card.name).toContain('What are the lung volumes?');
    expect(card.name).not.toContain('<del>');
    expect(card.name).not.toContain('2001');
  });

  it('keeps struck text visible and adds no tags when tags are off', async () => {
    const [answer, question] = await convert(new CardOption({ tags: 'false' }));

    expect(answer.tags).toEqual([]);
    expect(answer.back).toContain('<del>2025</del>');
    expect(question.tags).toEqual([]);
    expect(question.name).toContain('<del>2001</del>');
  });

  it('keeps struck text visible when tags come from headings', async () => {
    const [answer] = await convert(new CardOption({}), page, {
      rules: headingRules(),
    });

    expect(answer.back).toContain('<del>2025</del>');
    expect(answer.tags).toEqual([]);
  });

  it('does not carry the tags of a skipped all-struck question onto the next card', async () => {
    const [card] = await convert(new CardOption({}), {
      'page-1': [
        block('t-1', 'toggle', [struck('draft')], true),
        block('t-2', 'toggle', [richText('What is FRC?')], true),
      ],
      't-1': [block('p-1', 'paragraph', [struck('old'), richText(' note')])],
      't-2': [block('p-2', 'paragraph', [richText('Volume after exhale')])],
    });

    expect(card.name).toContain('What is FRC?');
    expect(card.tags).toEqual([]);
  });

  it('tags a promoted nested toggle with the struck text on its own answer', async () => {
    const cards = await convert(
      new CardOption({ 'promote-nested-toggles': 'true' }),
      {
        'page-1': [block('t-1', 'toggle', [richText('Lungs')], true)],
        't-1': [
          block('n-1', 'toggle', [richText('Define FRC')], true),
          block('n-2', 'toggle', [richText('Define TLC')], true),
        ],
        'n-1': [block('p-1', 'paragraph', [richText('Rest'), struck('2025')])],
        'n-2': [block('p-2', 'paragraph', [richText('Total')])],
      }
    );

    const byFront = (front: string) =>
      cards.find((card) => card.name.includes(front));
    expect(byFront('Define FRC')?.tags).toEqual(['2025']);
    expect(byFront('Define TLC')?.tags).toEqual([]);
  });

  it('keeps struck text on cards built by a picked paragraphs rule', async () => {
    const termParagraph = (id: string, term: string, rest: string) =>
      block(id, 'paragraph', [
        {
          ...richText(term),
          annotations: { ...richText(term).annotations, bold: true },
        },
        richText(rest),
      ]);
    const cards = await convert(
      new CardOption({}),
      {
        'page-1': [
          termParagraph(
            'p-1',
            'Osmosis',
            ' is water moving across a membrane.'
          ),
          termParagraph('p-2', 'Diffusion', ' spreads particles to low areas.'),
          block('p-3', 'paragraph', [
            {
              ...richText('Active transport'),
              annotations: { ...richText('x').annotations, bold: true },
            },
            richText(' moves molecules '),
            struck('passively'),
            richText(' using energy.'),
          ]),
        ],
      },
      { rescueRule: 'paragraphs' }
    );

    expect(cards).toHaveLength(3);
    expect(cards[2].back).toContain('<del>passively</del>');
  });
});

function withFields(
  base: ReturnType<typeof block>,
  type: string,
  fields: Record<string, unknown>
) {
  const own = base[type] as Record<string, unknown>;
  return { ...base, [type]: { ...own, ...fields } };
}

describe('strikethrough tags in every block that renders rich text', () => {
  it('tags and removes struck runs in a quote, heading, callout and code block on the answer', async () => {
    const [card] = await convert(new CardOption({}), {
      'page-1': [block('t-1', 'toggle', [richText('Mixed answer')], true)],
      't-1': [
        block('q-1', 'quote', [richText('Quoted '), struck('q-tag')]),
        withFields(
          block('h-1', 'heading_2', [richText('Heading '), struck('h-tag')]),
          'heading_2',
          { is_toggleable: false }
        ),
        withFields(
          block('c-1', 'callout', [richText('Callout '), struck('c-tag')]),
          'callout',
          { icon: null }
        ),
        withFields(
          block('k-1', 'code', [richText('let x'), struck('k-tag')]),
          'code',
          { language: 'javascript', caption: [] }
        ),
      ],
    });

    expect(card.tags).toEqual(['q-tag', 'h-tag', 'c-tag', 'k-tag']);
    expect(card.back).toContain('Quoted');
    expect(card.back).toContain('Callout');
    expect(card.back).not.toContain('<del>');
    expect(card.back).not.toMatch(/q-tag|h-tag|c-tag|k-tag/);
  });
});

describe('strikethrough tags on a connected Notion database', () => {
  function makeDatabaseApi(): NotionAPIWrapper {
    const api = makeApi({
      'row-1': [block('t-1', 'toggle', [richText('What lowers FRC?')], true)],
      't-1': [
        block('p-1', 'paragraph', [richText('Supine posture')]),
        block('p-2', 'paragraph', [
          struck('2025'),
          richText(' '),
          struck('2004'),
        ]),
      ],
    }) as unknown as Record<string, unknown>;
    return {
      ...api,
      notionRequestCount: 0,
      captureForbiddenBlocks: vi.fn(() => new Set<string>()),
      restoreForbiddenBlocks: vi.fn(),
      queryDatabase: vi.fn().mockResolvedValue({
        results: [
          {
            id: 'row-1',
            properties: {
              Name: {
                type: 'title',
                title: [richText('Lecture 1')],
              },
            },
          },
        ],
      }),
      getDatabase: vi.fn().mockResolvedValue({ id: 'db-1' }),
      getDatabaseTitle: vi.fn().mockResolvedValue('Physiology'),
    } as unknown as NotionAPIWrapper;
  }

  it('tags and removes struck runs on cards from a database row page', async () => {
    const handler = new BlockHandler(
      new CustomExporter('', new Workspace(true, 'fs').location),
      makeDatabaseApi(),
      new CardOption({})
    );

    const decks = await handler.findFlashcards({
      parentType: 'notion-database',
      topLevelId: 'db-1',
      rules: new ParserRules(),
      decks: [],
      parentName: '',
    });

    const [card] = decks.flatMap((deck) => deck.cards);
    expect(handler.resolvedDatabasePath).toMatchObject({ rowPageWalk: true });
    expect(card.tags).toEqual(['2025', '2004']);
    expect(card.back).toContain('Supine posture');
    expect(card.back).not.toContain('<del>');
  });
});

describe('the single-block preview renderer with default card options', () => {
  it('leaves struck tag text out of the rendered block, as the card does', async () => {
    const handler = new BlockHandler(
      new CustomExporter('x', new Workspace(true, 'fs').location),
      makeApi({}),
      new CardOption(CardOption.LoadDefaultOptions())
    );
    const preview = block('p-1', 'paragraph', [
      richText('Supine posture '),
      struck('2025'),
    ]);

    const html = await blockToStaticMarkup(
      handler,
      preview as unknown as BlockObjectResponse
    );

    expect(html).toContain('Supine posture');
    expect(html).not.toContain('2025');
  });
});

describe('strikethrough tags on table cards', () => {
  function tableRow(id: string, cells: ReturnType<typeof richText>[][]) {
    return { ...block(id, 'table_row', []), table_row: { cells } };
  }

  it('tags only the row whose cell holds the struck text', async () => {
    const rules = new ParserRules();
    rules.setFlashcardTypes(['table']);
    const table = {
      ...block('tb-1', 'table', [], true),
      table: {
        table_width: 2,
        has_column_header: false,
        has_row_header: false,
      },
    };

    const cards = await convert(
      new CardOption({}),
      {
        'page-1': [table],
        'tb-1': [
          tableRow('r-1', [[richText('France')], [richText('Paris')]]),
          tableRow('r-2', [
            [richText('Spain')],
            [richText('Madrid '), struck('cap')],
          ]),
          tableRow('r-3', [[richText('Italy')], [struck('draft')]]),
          tableRow('r-4', [[richText('Peru')], [richText('Lima')]]),
        ],
      },
      { rules }
    );

    expect(cards.map((card) => [card.name, card.tags])).toEqual([
      ['France', []],
      ['Spain', ['cap']],
      ['Peru', []],
    ]);
    expect(cards[1].back).not.toContain('cap');
  });
});

describe('strikethrough tags on cloze and typed-answer fronts', () => {
  function annotated(
    content: string,
    annotations: Partial<ReturnType<typeof richText>['annotations']>
  ) {
    const base = richText(content);
    return { ...base, annotations: { ...base.annotations, ...annotations } };
  }

  it('leaves a struck run off a cloze front and keeps it as a tag', async () => {
    const [card] = await convert(new CardOption({ cloze: 'true' }), {
      'page-1': [
        block(
          't-1',
          'toggle',
          [
            richText('The capital is '),
            annotated('Paris', { code: true }),
            richText(' '),
            struck('2025'),
          ],
          true
        ),
      ],
      't-1': [block('p-1', 'paragraph', [richText('Extra')])],
    });

    expect(card.cloze).toBe(true);
    expect(card.name).toContain('{{c1::Paris}}');
    expect(card.name).not.toContain('2025');
    expect(card.tags).toEqual(['2025']);
  });

  it('keeps a struck run on a cloze front when tags are off', async () => {
    const [card] = await convert(
      new CardOption({ cloze: 'true', tags: 'false' }),
      {
        'page-1': [
          block(
            't-1',
            'toggle',
            [annotated('Paris', { code: true }), richText(' '), struck('2025')],
            true
          ),
        ],
        't-1': [block('p-1', 'paragraph', [richText('Extra')])],
      }
    );

    expect(card.name).toContain('2025');
    expect(card.tags).toEqual([]);
  });

  it('leaves a struck run off a typed-answer front and keeps it as a tag', async () => {
    const [card] = await convert(
      new CardOption({ 'enable-input': 'true', cloze: 'false' }),
      {
        'page-1': [
          block(
            't-1',
            'toggle',
            [
              richText('Capital of France: '),
              annotated('Paris', { bold: true }),
              richText(' '),
              struck('2025'),
            ],
            true
          ),
        ],
        't-1': [block('p-1', 'paragraph', [richText('Extra')])],
      }
    );

    expect(card.enableInput).toBe(true);
    expect(card.answer).toBe('Paris');
    expect(card.name).not.toContain('2025');
    expect(card.tags).toEqual(['2025']);
  });
});

describe('strikethrough tags in lists, nested toggles and column cards', () => {
  it('tags and removes struck runs in list items and a nested toggle on the answer', async () => {
    const [card] = await convert(new CardOption({}), {
      'page-1': [block('t-1', 'toggle', [richText('Lists')], true)],
      't-1': [
        block('b-1', 'bulleted_list_item', [
          richText('Bullet '),
          struck('b-tag'),
        ]),
        block('n-1', 'numbered_list_item', [
          richText('Number '),
          struck('n-tag'),
        ]),
        block('t-2', 'toggle', [richText('Inner '), struck('i-tag')], true),
      ],
      't-2': [block('p-1', 'paragraph', [richText('Inner answer')])],
    });

    expect(card.tags).toEqual(['b-tag', 'n-tag', 'i-tag']);
    expect(card.back).toContain('Bullet');
    expect(card.back).not.toMatch(/b-tag|n-tag|i-tag|<del>/);
  });

  it('tags a column-list card with the struck runs in its own columns only', async () => {
    const rules = new ParserRules();
    rules.setFlashcardTypes(['column_list']);
    const cards = await convert(
      new CardOption({}),
      {
        'page-1': [
          block('cl-1', 'column_list', [], true),
          block('cl-2', 'column_list', [], true),
        ],
        'cl-1': [
          block('c-1', 'column', [], true),
          block('c-2', 'column', [], true),
        ],
        'c-1': [block('p-1', 'paragraph', [richText('Front one')])],
        'c-2': [
          block('p-2', 'paragraph', [richText('Back one '), struck('2025')]),
        ],
        'cl-2': [
          block('c-3', 'column', [], true),
          block('c-4', 'column', [], true),
        ],
        'c-3': [block('p-3', 'paragraph', [richText('Front two')])],
        'c-4': [block('p-4', 'paragraph', [richText('Back two')])],
      },
      { rules }
    );

    expect(cards.map((card) => card.tags)).toEqual([['2025'], []]);
    expect(cards[0].back).not.toContain('2025');
  });
});

describe('strikethrough tags with a plain-text answer', () => {
  it('tags and removes struck runs in paragraphs, quotes, headings and code', async () => {
    const [card] = await convert(new CardOption({ paragraph: 'true' }), {
      'page-1': [block('t-1', 'toggle', [richText('Plain')], true)],
      't-1': [
        block('p-1', 'paragraph', [richText('Para '), struck('p-tag')]),
        block('q-1', 'quote', [richText('Quote '), struck('q-tag')]),
        withFields(
          block('h-1', 'heading_2', [richText('Head '), struck('h-tag')]),
          'heading_2',
          { is_toggleable: false }
        ),
        withFields(
          block('k-1', 'code', [richText('code '), struck('k-tag')]),
          'code',
          { language: 'javascript', caption: [] }
        ),
      ],
    });

    expect(card.tags).toEqual(['p-tag', 'q-tag', 'h-tag', 'k-tag']);
    expect(card.back).toContain('Quote');
    expect(card.back).not.toMatch(/p-tag|q-tag|h-tag|k-tag/);
  });

  it('keeps struck text in a plain-text answer when tags are off', async () => {
    const [card] = await convert(
      new CardOption({ paragraph: 'true', tags: 'false' }),
      {
        'page-1': [block('t-1', 'toggle', [richText('Plain')], true)],
        't-1': [block('q-1', 'quote', [richText('Quote '), struck('q-tag')])],
      }
    );

    expect(card.tags).toEqual([]);
    expect(card.back).toContain('q-tag');
  });
});

describe('strikethrough tags on multiple-choice cards', () => {
  const bold = (content: string) => ({
    ...richText(content),
    annotations: { ...richText(content).annotations, bold: true },
  });

  it('takes struck text out of the options, drops an all-struck option and keeps the answer', async () => {
    const [card] = await convert(new CardOption({ 'mcq-enabled': 'true' }), {
      'page-1': [
        block('t-1', 'toggle', [richText('Capital of France?')], true),
      ],
      't-1': [
        block('o-1', 'bulleted_list_item', [richText('London')]),
        block('o-2', 'bulleted_list_item', [struck('2025')]),
        block('o-3', 'bulleted_list_item', [
          bold('Paris'),
          richText(' '),
          struck('2004'),
        ]),
        block('o-4', 'bulleted_list_item', [richText('Berlin')]),
      ],
    });

    expect(card.mcq).toBe(true);
    expect(card.options).toEqual(['London', 'Paris', 'Berlin']);
    expect(card.correctIndices).toEqual([1]);
    expect(card.tags).toEqual(['2025', '2004']);
  });
});

describe('strikethrough on rescued decks', () => {
  const heading = (id: string, text: string) =>
    withFields(block(id, 'heading_2', [richText(text)]), 'heading_2', {
      is_toggleable: false,
    });

  it('keeps struck text on cards from an automatically shipped rescue', async () => {
    const cards = await convert(new CardOption({}), {
      'page-1': [
        block('t-1', 'toggle', [richText('An empty toggle')]),
        heading('h-1', 'What is spaced repetition?'),
        block('p-1', 'paragraph', [
          richText('A method that spaces reviews '),
          struck('draft'),
        ]),
        heading('h-2', 'What is a flashcard?'),
        block('p-2', 'paragraph', [
          richText('A prompt paired with an answer.'),
        ]),
        heading('h-3', 'What is active recall?'),
        block('p-3', 'paragraph', [richText('Retrieving a fact from memory.')]),
      ],
    });

    expect(cards).toHaveLength(3);
    expect(cards[0].back).toContain('<del>draft</del>');
  });

  it('keeps struck text on cards from a degenerate-yield rescue', async () => {
    const oversized = 'Photosynthesis stores light energy in glucose. '.repeat(
      30
    );
    const cards = await convert(new CardOption({}), {
      'page-1': [
        block('t-1', 'toggle', [richText('Cell biology overview')], true),
        heading('h-1', 'What is the cell membrane?'),
        block('p-1', 'paragraph', [
          richText('A lipid bilayer. '),
          struck('draft'),
        ]),
        heading('h-2', 'What is the nucleus?'),
        block('p-2', 'paragraph', [
          richText('It houses the genetic material.'),
        ]),
        heading('h-3', 'What are mitochondria?'),
        block('p-3', 'paragraph', [richText('They generate chemical energy.')]),
        heading('h-4', 'What is the cytoplasm?'),
        block('p-4', 'paragraph', [richText('The fluid inside a cell.')]),
      ],
      't-1': [block('p-0', 'paragraph', [richText(oversized)])],
    });

    const membrane = cards.find((card) => card.name.includes('cell membrane'));
    expect(membrane?.back).toContain('<del>draft</del>');
  });
});

describe('strikethrough edge cases on table headers, equations and typed answers', () => {
  it('keeps struck header text off the first row', async () => {
    const rules = new ParserRules();
    rules.setFlashcardTypes(['table']);
    const tableRow = (id: string, cells: ReturnType<typeof richText>[][]) => ({
      ...block(id, 'table_row', []),
      table_row: { cells },
    });
    const cards = await convert(
      new CardOption({}),
      {
        'page-1': [
          {
            ...block('tb-1', 'table', [], true),
            table: {
              table_width: 2,
              has_column_header: true,
              has_row_header: false,
            },
          },
        ],
        'tb-1': [
          tableRow('r-0', [
            [richText('Front')],
            [richText('Back '), struck('h-tag')],
          ]),
          tableRow('r-1', [[richText('France')], [richText('Paris')]]),
        ],
      },
      { rules }
    );

    expect(cards.map((card) => card.tags)).toEqual([[]]);
  });

  it('keeps a struck inline equation on a cloze front', async () => {
    const equation = {
      type: 'equation' as const,
      equation: { expression: 'E=mc^2' },
      annotations: { ...richText('x').annotations, strikethrough: true },
      plain_text: 'E=mc^2',
      href: null,
    };
    const [card] = await convert(new CardOption({ cloze: 'true' }), {
      'page-1': [
        block(
          't-1',
          'toggle',
          [
            {
              ...richText('Paris'),
              annotations: { ...richText('x').annotations, code: true },
            },
            richText(' and '),
            equation as unknown as ReturnType<typeof richText>,
          ],
          true
        ),
      ],
      't-1': [block('p-1', 'paragraph', [richText('Extra')])],
    });

    expect(card.cloze).toBe(true);
    expect(card.name).toContain('E=mc^2');
  });

  it('keeps a struck run on a typed-answer front when tags are off', async () => {
    const [card] = await convert(
      new CardOption({ 'enable-input': 'true', cloze: 'false', tags: 'false' }),
      {
        'page-1': [
          block(
            't-1',
            'toggle',
            [
              {
                ...richText('Paris'),
                annotations: { ...richText('x').annotations, bold: true },
              },
              richText(' '),
              struck('2025'),
            ],
            true
          ),
        ],
        't-1': [block('p-1', 'paragraph', [richText('Extra')])],
      }
    );

    expect(card.name).toContain('2025');
    expect(card.tags).toEqual([]);
  });
});

describe('a toggle whose whole answer is struck', () => {
  it('becomes tags only, so the card is dropped as an empty answer', async () => {
    const handler = new BlockHandler(
      new CustomExporter('', new Workspace(true, 'fs').location),
      makeApi({
        'page-1': [
          block('t-1', 'toggle', [richText('Only tags inside')], true),
          block('t-2', 'toggle', [richText('Has an answer')], true),
        ],
        't-1': [block('p-1', 'paragraph', [struck('2025')])],
        't-2': [block('p-2', 'paragraph', [richText('Answer')])],
      }),
      new CardOption({})
    );

    const decks = await handler.findFlashcards({
      parentType: 'page',
      topLevelId: 'page-1',
      rules: new ParserRules(),
      decks: [],
      parentName: '',
    });

    const cards = decks.flatMap((deck) => deck.cards);
    expect(cards.map((card) => [card.name, card.tags])).toEqual([
      ['Has an answer', []],
    ]);
    expect(handler.emptyBackCount).toBe(1);
  });
});
