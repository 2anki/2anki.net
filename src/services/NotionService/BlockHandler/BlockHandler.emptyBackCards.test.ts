import { vi, type MockedFunction } from 'vitest';
import BlockHandler from './BlockHandler';
import CardOption from '../../../lib/parser/Settings/CardOption';
import CustomExporter from '../../../lib/parser/exporters/CustomExporter';
import ParserRules from '../../../lib/parser/ParserRules';
import Workspace from '../../../lib/parser/WorkSpace';
import Deck from '../../../lib/parser/Deck';
import NotionAPIWrapper from '../NotionAPIWrapper';
import { setupTests } from '../../../test/configure-jest';
import { downloadMediaOrSkip } from '../helpers/downloadMediaOrSkip';

vi.mock('../helpers/downloadMediaOrSkip', () => ({
  __esModule: true,
  downloadMediaOrSkip: vi.fn(),
}));

const mockedDownload = downloadMediaOrSkip as MockedFunction<
  typeof downloadMediaOrSkip
>;

beforeEach(() => {
  setupTests();
  mockedDownload.mockReset();
  mockedDownload.mockResolvedValue(null);
});

const PARENT_PAGE = '11111111-1111-4111-8111-111111111111';
const CHILD_PAGE = '22222222-2222-4222-8222-222222222222';
const EDITED = '2026-11-01T00:00:00.000Z';

type FakeBlock = Record<string, unknown> & { id: string };

type Annotations = { bold?: boolean; code?: boolean; strikethrough?: boolean };

function richText(text: string, annotations: Annotations = {}) {
  return [
    {
      type: 'text' as const,
      text: { content: text, link: null },
      annotations: {
        bold: annotations.bold ?? false,
        italic: false,
        strikethrough: annotations.strikethrough ?? false,
        underline: false,
        code: annotations.code ?? false,
        color: 'default' as const,
      },
      plain_text: text,
      href: null,
    },
  ];
}

function block(
  id: string,
  type: string,
  body: Record<string, unknown>,
  hasChildren = false
): FakeBlock {
  return {
    object: 'block',
    id,
    created_time: EDITED,
    last_edited_time: EDITED,
    created_by: { object: 'user', id: 'user-1' },
    last_edited_by: { object: 'user', id: 'user-1' },
    has_children: hasChildren,
    archived: false,
    in_trash: false,
    parent: { type: 'page_id', page_id: PARENT_PAGE },
    type,
    [type]: body,
  };
}

const toggle = (id: string, front: string, hasChildren = true) =>
  block(
    id,
    'toggle',
    { rich_text: richText(front), color: 'default' },
    hasChildren
  );
const emptyToggle = (id: string, front: string) => toggle(id, front, false);
const bullet = (id: string, text: string) =>
  block(id, 'bulleted_list_item', {
    rich_text: richText(text),
    color: 'default',
  });
const paragraph = (id: string, text: string) =>
  block(id, 'paragraph', { rich_text: richText(text), color: 'default' });
const emptyParagraph = (id: string) =>
  block(id, 'paragraph', { rich_text: [], color: 'default' });
const heading = (id: string, text: string) =>
  block(id, 'heading_2', {
    rich_text: richText(text),
    color: 'default',
    is_toggleable: false,
  });
const callout = (id: string, text: string) =>
  block(id, 'callout', {
    rich_text: richText(text),
    color: 'default',
    icon: null,
  });
const childPage = (id: string, title: string) =>
  block(id, 'child_page', { title }, true);
const syncedOriginal = (id: string) =>
  block(id, 'synced_block', { synced_from: null }, true);

function page(id: string, title: string) {
  return {
    object: 'page',
    id,
    created_time: EDITED,
    last_edited_time: EDITED,
    url: `https://www.notion.so/${id.replaceAll('-', '')}`,
    icon: null,
    properties: {
      title: { id: 'title', type: 'title', title: richText(title) },
    },
  };
}

function toggleWithBullets(
  tree: Record<string, FakeBlock[]>,
  id: string,
  front: string
): FakeBlock {
  tree[id] = [
    bullet(`${id}-b1`, `${front} first`),
    bullet(`${id}-b2`, `${front} second`),
  ];
  return toggle(id, front);
}

function makeSdk(
  tree: Record<string, FakeBlock[]>,
  pages: Record<string, ReturnType<typeof page>>
) {
  return {
    pages: {
      retrieve: vi.fn(
        async ({ page_id }: { page_id: string }) => pages[page_id]
      ),
    },
    blocks: {
      retrieve: vi.fn(),
      children: {
        list: vi.fn(async ({ block_id }: { block_id: string }) => ({
          object: 'list',
          type: 'block',
          block: {},
          results: structuredClone(tree[block_id] ?? []),
          next_cursor: null,
          has_more: false,
        })),
      },
    },
  };
}

function parentOnly(tree: Record<string, FakeBlock[]>) {
  return makeSdk(tree, { [PARENT_PAGE]: page(PARENT_PAGE, 'Parent') });
}

function makeHandler(
  sdk: ReturnType<typeof makeSdk>,
  useAll: boolean,
  options: Record<string, string> = {}
): BlockHandler {
  const api = new NotionAPIWrapper('test-token', '1');
  (api as unknown as { notion: unknown }).notion = sdk;
  const exporter = new CustomExporter('', new Workspace(true, 'fs').location);
  const handler = new BlockHandler(exporter, api, new CardOption(options));
  handler.useAll = useAll;
  return handler;
}

function convert(handler: BlockHandler, rules = new ParserRules()) {
  return handler.findFlashcards({
    parentType: 'page',
    topLevelId: PARENT_PAGE,
    rules,
    decks: [],
    parentName: '',
  });
}

function delivered(decks: Deck[]) {
  return decks
    .filter((deck) => deck.cards.length > 0)
    .map((deck) => ({
      name: deck.name,
      cards: deck.cards.map((card) => ({
        name: card.name,
        back: card.back,
        notionId: card.notionId,
      })),
    }));
}

function backOf(id: string, front: string) {
  return (
    `<ul id="${id}-b1" class="bulleted-list">` +
    `<li id="${id}-b1" class=""><div>${front} first</div></li>` +
    `<li id="${id}-b2" class=""><div>${front} second</div></li></ul>`
  );
}

const imageBlock = (id: string) =>
  block(id, 'image', {
    type: 'external',
    external: { url: 'https://example.com/cell.png' },
    caption: [],
  });
const childDatabase = (id: string, title: string) =>
  block(id, 'child_database', { title });

function failingChildrenFor(
  sdk: ReturnType<typeof makeSdk>,
  failingId: string
) {
  const list = sdk.blocks.children.list.getMockImplementation()!;
  sdk.blocks.children.list.mockImplementation(async (args) => {
    if (args.block_id === failingId) {
      throw new Error('children fetch failed');
    }
    return list(args);
  });
  return sdk;
}

function linkTo(pageId: string, blockId: string) {
  const href = `https://www.notion.so/${pageId.replaceAll('-', '')}#${blockId.replaceAll('-', '')}`;
  return `<div style="text-align:center"><a style="text-decoration:none;color:grey" href="${href}">Open in Notion</a></div>`;
}

const LINK_ON = { 'add-notion-link': 'true' };

const LONG_ANSWER = 'Mitochondria convert nutrients into energy. '.repeat(35);

const PLANS = [
  ['paid', true],
  ['free', false],
] as const;

function toggleSubDeckRules() {
  const rules = new ParserRules();
  rules.SUB_DECKS = ['toggle'];
  return rules;
}

function nestedToggleMarkup(id: string, front: string, body: string) {
  return `<ul id="${id}" class="toggle"><li><details><summary>${front}</summary><div>${body}</div></details></li></ul>`;
}

describe('BlockHandler empty back cards', () => {
  describe.each(PLANS)(
    'an empty toggle with the Notion link option on a %s conversion',
    (_plan, useAll) => {
      it('drops a toggle with no children and counts it as an empty back', async () => {
        const tree: Record<string, FakeBlock[]> = {};
        tree[PARENT_PAGE] = [
          toggleWithBullets(tree, 't-Full', 'Full'),
          emptyToggle('t-Empty', 'Empty'),
        ];
        const handler = makeHandler(parentOnly(tree), useAll, LINK_ON);
        const decks = await convert(handler);

        expect(delivered(decks)).toEqual([
          {
            name: 'Parent',
            cards: [
              {
                name: 'Full',
                back: backOf('t-Full', 'Full') + linkTo(PARENT_PAGE, 't-Full'),
                notionId: 't-Full',
              },
            ],
          },
        ]);
        expect(handler.emptyBackCount).toBe(1);
        expect(handler.cardCount).toBe(2);
        expect(handler.blocksSeen).toBe(2);
      });

      it('drops a toggle whose answer is only an empty paragraph', async () => {
        const tree: Record<string, FakeBlock[]> = {};
        tree[PARENT_PAGE] = [
          toggleWithBullets(tree, 't-Full', 'Full'),
          toggle('t-Blank', 'Blank'),
        ];
        tree['t-Blank'] = [emptyParagraph('p-blank')];
        const handler = makeHandler(parentOnly(tree), useAll, LINK_ON);
        const decks = await convert(handler);

        expect(
          delivered(decks).flatMap((deck) => deck.cards.map((c) => c.notionId))
        ).toEqual(['t-Full']);
        expect(handler.emptyBackCount).toBe(1);
      });
    }
  );

  describe('a page of only empty toggles with the Notion link option on', () => {
    it('delivers no card and reads the empty answers reason', async () => {
      const tree: Record<string, FakeBlock[]> = {};
      tree[PARENT_PAGE] = [emptyToggle('t-A', 'A'), emptyToggle('t-B', 'B')];
      const handler = makeHandler(parentOnly(tree), true, LINK_ON);
      const decks = await convert(handler);

      expect(delivered(decks)).toEqual([]);
      expect(handler.emptyDeckReason()).toBe('empty_answers');
    });

    it('rescues the page from its headings', async () => {
      const tree: Record<string, FakeBlock[]> = {};
      tree[PARENT_PAGE] = [
        emptyToggle('t-A', 'A'),
        heading('h1', 'Cells'),
        paragraph('p1', 'Cells are the basic unit of life.'),
        heading('h2', 'Tissues'),
        paragraph('p2', 'Tissues are groups of similar cells.'),
        heading('h3', 'Organs'),
        paragraph('p3', 'Organs are groups of tissues.'),
      ];
      const handler = makeHandler(parentOnly(tree), true, LINK_ON);
      const decks = await convert(handler);

      expect(
        delivered(decks).map((deck) => [
          deck.name,
          deck.cards.map((card) => card.name),
        ])
      ).toEqual([['Parent', ['Cells', 'Tissues', 'Organs']]]);
      expect(handler.inducedRule?.outcome).toBe('rescue_shipped');
      expect(handler.emptyBackCount).toBe(0);
    });
  });

  describe('the Notion link option with basic and reversed on', () => {
    it('drops an empty toggle and its reverse companion, and keeps the full card and its companion as before', async () => {
      const tree: Record<string, FakeBlock[]> = {};
      tree[PARENT_PAGE] = [
        toggleWithBullets(tree, 't-Full', 'Full'),
        emptyToggle('t-Empty', 'Empty'),
      ];
      const handler = makeHandler(parentOnly(tree), true, {
        ...LINK_ON,
        'basic-reversed': 'true',
      });
      const decks = await convert(handler);

      const fullBack = backOf('t-Full', 'Full') + linkTo(PARENT_PAGE, 't-Full');
      expect(delivered(decks)).toEqual([
        {
          name: 'Parent',
          cards: [
            { name: 'Full', back: fullBack, notionId: 't-Full' },
            { name: fullBack, back: 'Full', notionId: undefined },
          ],
        },
      ]);
      expect(handler.emptyBackCount).toBe(1);
    });
  });

  describe('the Notion link option with the reversed swap on', () => {
    it('drops an empty toggle without counting it', async () => {
      const tree: Record<string, FakeBlock[]> = {};
      tree[PARENT_PAGE] = [
        toggleWithBullets(tree, 't-Full', 'Full'),
        emptyToggle('t-Empty', 'Empty'),
      ];
      const handler = makeHandler(parentOnly(tree), true, {
        ...LINK_ON,
        reversed: 'true',
      });
      const decks = await convert(handler);

      expect(delivered(decks)).toEqual([
        {
          name: 'Parent',
          cards: [
            {
              name: backOf('t-Full', 'Full') + linkTo(PARENT_PAGE, 't-Full'),
              back: 'Full',
              notionId: 't-Full',
            },
          ],
        },
      ]);
      expect(handler.emptyBackCount).toBe(0);
    });
  });

  describe('the Notion link option on a cloze toggle', () => {
    it('keeps a cloze toggle with no answer, with the link on its back', async () => {
      const tree: Record<string, FakeBlock[]> = {};
      tree[PARENT_PAGE] = [
        block(
          't-Cloze',
          'toggle',
          {
            rich_text: [
              ...richText('Mitochondria is the '),
              ...richText('powerhouse', { code: true }),
            ],
            color: 'default',
          },
          false
        ),
      ];
      const handler = makeHandler(parentOnly(tree), true, LINK_ON);
      const decks = await convert(handler);

      expect(delivered(decks)).toEqual([
        {
          name: 'Parent',
          cards: [
            {
              name: 'Mitochondria is the {{c1::powerhouse}}',
              back: linkTo(PARENT_PAGE, 't-Cloze'),
              notionId: 't-Cloze',
            },
          ],
        },
      ]);
    });
  });

  describe('the Notion link option on a typed-answer toggle', () => {
    it('keeps a typed-answer toggle with no answer, with the link on its back', async () => {
      const tree: Record<string, FakeBlock[]> = {};
      tree[PARENT_PAGE] = [
        block(
          't-Input',
          'toggle',
          {
            rich_text: [
              ...richText('Capital of France: '),
              ...richText('Paris', { bold: true }),
            ],
            color: 'default',
          },
          false
        ),
      ];
      const handler = makeHandler(parentOnly(tree), true, {
        ...LINK_ON,
        'enable-input': 'true',
        cloze: 'false',
      });
      const decks = await convert(handler);

      expect(delivered(decks)).toEqual([
        {
          name: 'Parent',
          cards: [
            {
              name: 'Capital of France: ',
              back: linkTo(PARENT_PAGE, 't-Input'),
              notionId: 't-Input',
            },
          ],
        },
      ]);
    });
  });

  describe('the Notion link option with nested toggle promotion on', () => {
    it('drops a promoted nested toggle whose answer is only an empty paragraph and counts it', async () => {
      const tree: Record<string, FakeBlock[]> = {};
      tree[PARENT_PAGE] = [toggle('t-Outer', 'Outer')];
      tree['t-Outer'] = [
        paragraph('p-outer', 'Outer answer'),
        toggle('t-Inner', 'Inner'),
      ];
      tree['t-Inner'] = [emptyParagraph('p-inner')];
      const handler = makeHandler(parentOnly(tree), true, {
        ...LINK_ON,
        'promote-nested-toggles': 'true',
      });
      const decks = await convert(handler);

      expect(
        delivered(decks).flatMap((deck) => deck.cards.map((c) => c.notionId))
      ).toEqual(['t-Outer']);
      expect(handler.emptyBackCount).toBe(1);
    });
  });

  describe('the Notion link option with the cherry option on', () => {
    it('drops a cherry-marked toggle with no answer and counts it', async () => {
      const tree: Record<string, FakeBlock[]> = {};
      tree[PARENT_PAGE] = [
        toggle('t-Full', 'Full 🍒'),
        emptyToggle('t-Empty', 'Empty 🍒'),
      ];
      tree['t-Full'] = [paragraph('p-full', 'An answer')];
      const handler = makeHandler(parentOnly(tree), true, {
        ...LINK_ON,
        cherry: 'true',
      });
      const decks = await convert(handler);

      expect(
        delivered(decks).flatMap((deck) => deck.cards.map((c) => c.notionId))
      ).toEqual(['t-Full']);
      expect(handler.emptyBackCount).toBe(1);
    });
  });

  describe('the Notion link option on childless non-toggle flashcard types', () => {
    it.each([
      [
        'paragraph',
        paragraph('x-1', 'A fact'),
        '<p class="" id="x-1">A fact</p>',
      ],
      [
        'quote',
        block('x-1', 'quote', {
          rich_text: richText('A fact'),
          color: 'default',
        }),
        '<blockquote class="" id="x-1">A fact</blockquote>',
      ],
      [
        'code',
        block('x-1', 'code', {
          rich_text: richText('A fact'),
          caption: [],
          language: 'plain text',
        }),
        '<pre id="x-1" class="code"><code>A fact</code></pre>',
      ],
      [
        'heading_1',
        block('x-1', 'heading_1', {
          rich_text: richText('A fact'),
          color: 'default',
          is_toggleable: false,
        }),
        '<h1 id="x-1" class="">A fact</h1>',
      ],
      [
        'callout',
        callout('x-1', 'A fact'),
        '<figure id="x-1" class="callout" style="white-space:pre-wrap;display:flex"><div></div><div style="width:100%">A fact</div></figure>',
      ],
    ])(
      'keeps a childless %s card with the link, as on main',
      async (type, lone, front) => {
        const tree: Record<string, FakeBlock[]> = {};
        tree[PARENT_PAGE] = [lone];
        const rules = new ParserRules();
        rules.setFlashcardTypes([type]);
        const handler = makeHandler(parentOnly(tree), true, LINK_ON);
        const decks = await convert(handler, rules);

        expect(delivered(decks)).toEqual([
          {
            name: 'Parent',
            cards: [
              {
                name: front,
                back: linkTo(PARENT_PAGE, 'x-1'),
                notionId: 'x-1',
              },
            ],
          },
        ]);
        expect(handler.emptyBackCount).toBe(0);
      }
    );
  });

  describe('the Notion link option with strikethrough tags on', () => {
    it('keeps a toggle whose answer is only struck text, with the link, as before', async () => {
      const tree: Record<string, FakeBlock[]> = {};
      tree[PARENT_PAGE] = [
        toggle('t-Full', 'Full'),
        toggle('t-Struck', 'Struck'),
      ];
      tree['t-Full'] = [
        block('p-full', 'paragraph', {
          rich_text: [
            ...richText('An answer'),
            ...richText('biology', { strikethrough: true }),
          ],
          color: 'default',
        }),
      ];
      tree['t-Struck'] = [
        block('p-struck', 'paragraph', {
          rich_text: richText('biology', { strikethrough: true }),
          color: 'default',
        }),
      ];
      const handler = makeHandler(parentOnly(tree), true, LINK_ON);
      const decks = await convert(handler);

      const cards = delivered(decks).flatMap((deck) => deck.cards);
      expect(cards.map((c) => c.notionId)).toEqual(['t-Full', 't-Struck']);
      expect(decks[0].cards.map((c) => c.tags)).toEqual([
        ['biology'],
        ['biology'],
      ]);
      expect(cards[1].back).toBe(
        '<p class="" id="p-struck"></p>' + linkTo(PARENT_PAGE, 't-Struck')
      );
      expect(handler.emptyBackCount).toBe(0);
    });
  });

  describe('the Notion link option with use Notion ID on', () => {
    it('drops the empty toggle and keeps the full card with its block id', async () => {
      const tree: Record<string, FakeBlock[]> = {};
      tree[PARENT_PAGE] = [
        toggleWithBullets(tree, 't-Full', 'Full'),
        emptyToggle('t-Empty', 'Empty'),
      ];
      const handler = makeHandler(parentOnly(tree), true, {
        ...LINK_ON,
        'use-notion-id': 'true',
      });
      const decks = await convert(handler);

      expect(delivered(decks)).toEqual([
        {
          name: 'Parent',
          cards: [
            {
              name: 'Full',
              back: backOf('t-Full', 'Full') + linkTo(PARENT_PAGE, 't-Full'),
              notionId: 't-Full',
            },
          ],
        },
      ]);
    });
  });

  describe('the Notion link option on a synced block', () => {
    it('drops the empty toggle inside the synced block', async () => {
      const tree: Record<string, FakeBlock[]> = {};
      tree[PARENT_PAGE] = [syncedOriginal('s-src')];
      tree['s-src'] = [
        toggleWithBullets(tree, 't-Full', 'Full'),
        emptyToggle('t-Empty', 'Empty'),
      ];
      const handler = makeHandler(parentOnly(tree), false, LINK_ON);
      const decks = await convert(handler);

      expect(
        delivered(decks).flatMap((deck) => deck.cards.map((c) => c.notionId))
      ).toEqual(['t-Full']);
      expect(handler.emptyBackCount).toBe(1);
    });
  });

  describe.each(PLANS)(
    'the Notion link option in a child page on a %s conversion',
    (_plan, useAll) => {
      it('drops the empty toggle from the child deck', async () => {
        const tree: Record<string, FakeBlock[]> = {};
        tree[PARENT_PAGE] = [childPage(CHILD_PAGE, 'Child')];
        tree[CHILD_PAGE] = [
          toggleWithBullets(tree, 't-Full', 'Full'),
          emptyToggle('t-Empty', 'Empty'),
        ];
        const sdk = makeSdk(tree, {
          [PARENT_PAGE]: page(PARENT_PAGE, 'Parent'),
          [CHILD_PAGE]: page(CHILD_PAGE, 'Child'),
        });
        const handler = makeHandler(sdk, useAll, LINK_ON);
        const decks = await convert(handler);

        expect(delivered(decks)).toEqual([
          {
            name: 'Parent::Child',
            cards: [
              {
                name: 'Full',
                back: backOf('t-Full', 'Full') + linkTo(CHILD_PAGE, 't-Full'),
                notionId: 't-Full',
              },
            ],
          },
        ]);
        expect(handler.emptyBackCount).toBe(1);
      });
    }
  );

  describe('a toggle whose answer the card cannot show, with the Notion link option on', () => {
    function pageWithOneToggle(children: FakeBlock[]) {
      const tree: Record<string, FakeBlock[]> = {};
      tree[PARENT_PAGE] = [toggle('t-Q', 'Q')];
      tree['t-Q'] = children;
      return parentOnly(tree);
    }

    const linkOnlyCard = {
      name: 'Q',
      back: linkTo(PARENT_PAGE, 't-Q'),
      notionId: 't-Q',
    };

    it('keeps a toggle holding an image with embed images off, with the link, as on main', async () => {
      const handler = makeHandler(
        pageWithOneToggle([imageBlock('i-1')]),
        true,
        {
          ...LINK_ON,
          'embed-images': 'false',
        }
      );
      const decks = await convert(handler);

      expect(delivered(decks)).toEqual([
        { name: 'Parent', cards: [linkOnlyCard] },
      ]);
      expect(handler.emptyBackCount).toBe(0);
    });

    it('keeps a toggle holding an image with text only back on, with the link, as on main', async () => {
      const handler = makeHandler(
        pageWithOneToggle([imageBlock('i-1')]),
        true,
        {
          ...LINK_ON,
          paragraph: 'true',
        }
      );
      const decks = await convert(handler);

      expect(delivered(decks)).toEqual([
        {
          name: 'Parent',
          cards: [
            {
              name: 'Q',
              back: 'https://www.notion.so/11111111111141118111111111111111#tQ',
              notionId: 't-Q',
            },
          ],
        },
      ]);
    });

    it('keeps a toggle holding an inline database, with the link, as on main', async () => {
      const handler = makeHandler(
        pageWithOneToggle([childDatabase('d-1', 'Vocabulary')]),
        true,
        LINK_ON
      );
      const decks = await convert(handler);

      expect(delivered(decks)).toEqual([
        { name: 'Parent', cards: [linkOnlyCard] },
      ]);
    });

    it('keeps a toggle whose children could not be fetched, with the link, as on main', async () => {
      const sdk = failingChildrenFor(
        pageWithOneToggle([paragraph('p-1', 'An answer')]),
        't-Q'
      );
      const handler = makeHandler(sdk, true, LINK_ON);
      const decks = await convert(handler);

      expect(delivered(decks)).toEqual([
        { name: 'Parent', cards: [linkOnlyCard] },
      ]);
    });

    it('keeps a toggle whose image failed to download, with the link, as on main', async () => {
      const handler = makeHandler(
        pageWithOneToggle([imageBlock('i-1')]),
        true,
        LINK_ON
      );
      const decks = await convert(handler);

      expect(delivered(decks)).toEqual([
        { name: 'Parent', cards: [linkOnlyCard] },
      ]);
      expect(mockedDownload).toHaveBeenCalled();
      expect(handler.droppedAssetCount).toBe(1);
    });
  });

  describe('a long toggle beside an empty toggle and headings, with the Notion link option on', () => {
    function longToggleAndHeadings() {
      const tree: Record<string, FakeBlock[]> = {};
      tree[PARENT_PAGE] = [
        toggle('t-Long', 'Long'),
        emptyToggle('t-Empty', 'Empty'),
        heading('h1', 'Cells'),
        paragraph('p1', 'Cells are the basic unit of life.'),
        heading('h2', 'Tissues'),
        paragraph('p2', 'Tissues are groups of similar cells.'),
        heading('h3', 'Organs'),
        paragraph('p3', 'Organs are groups of tissues.'),
      ];
      tree['t-Long'] = [paragraph('p-long', LONG_ANSWER)];
      return parentOnly(tree);
    }

    it('measures the long card alone and delivers the heading structure, as with the link off', async () => {
      const linkOn = makeHandler(longToggleAndHeadings(), true, LINK_ON);
      const linkOff = makeHandler(longToggleAndHeadings(), true);
      const withLink = await convert(linkOn);
      const withoutLink = await convert(linkOff);

      const fronts = (decks: Deck[]) =>
        delivered(decks).map((deck) => [
          deck.name,
          deck.cards.map((card) => card.name),
        ]);
      expect(fronts(withLink)).toEqual(fronts(withoutLink));
      expect(fronts(withLink)).toEqual([
        ['Parent', ['Cells', 'Tissues', 'Organs']],
      ]);
      expect(linkOn.inducedRule?.outcome).toBe('rescue_shipped');
      expect(linkOff.inducedRule?.outcome).toBe('rescue_shipped');
    });
  });

  describe('a toggle sub-deck on a paid conversion', () => {
    it('keeps a sub-deck toggle holding an image with embed images off, with the link to its page', async () => {
      const tree: Record<string, FakeBlock[]> = {};
      tree[PARENT_PAGE] = [toggle('t-Chapter', 'Chapter')];
      tree['t-Chapter'] = [toggle('t-Q1', 'Q1'), emptyToggle('t-Q2', 'Q2')];
      tree['t-Q1'] = [imageBlock('i-1')];
      const handler = makeHandler(parentOnly(tree), true, {
        ...LINK_ON,
        'embed-images': 'false',
      });
      const decks = await convert(handler, toggleSubDeckRules());

      expect(delivered(decks)[1]).toEqual({
        name: 'Parent::Chapter',
        cards: [
          { name: 'Q1', back: linkTo(PARENT_PAGE, 't-Q1'), notionId: 't-Q1' },
        ],
      });
    });

    it('links a sub-deck card to its page with text only back on', async () => {
      const tree: Record<string, FakeBlock[]> = {};
      tree[PARENT_PAGE] = [toggle('t-Chapter', 'Chapter')];
      tree['t-Chapter'] = [toggle('t-Q1', 'Q1')];
      tree['t-Q1'] = [paragraph('p-1', 'An answer')];
      const handler = makeHandler(parentOnly(tree), true, {
        ...LINK_ON,
        paragraph: 'true',
      });
      const decks = await convert(handler, toggleSubDeckRules());

      expect(delivered(decks)[1].cards[0].back).toBe(
        'An answerhttps://www.notion.so/11111111111141118111111111111111#tQ1'
      );
    });
    it('drops the sub-deck cards with empty backs and keeps the rest', async () => {
      const tree: Record<string, FakeBlock[]> = {};
      tree[PARENT_PAGE] = [toggle('t-Chapter', 'Chapter')];
      tree['t-Chapter'] = [
        toggleWithBullets(tree, 't-Q1', 'Q1'),
        emptyToggle('t-Q2', 'Q2'),
      ];
      const handler = makeHandler(parentOnly(tree), true);
      const decks = await convert(handler, toggleSubDeckRules());

      expect(delivered(decks)).toEqual([
        {
          name: 'Parent',
          cards: [
            {
              name: 'Chapter',
              back:
                nestedToggleMarkup('t-Q1', 'Q1', backOf('t-Q1', 'Q1')) +
                nestedToggleMarkup('t-Q2', 'Q2', ''),
              notionId: 't-Chapter',
            },
          ],
        },
        {
          name: 'Parent::Chapter',
          cards: [{ name: 'Q1', back: backOf('t-Q1', 'Q1'), notionId: 't-Q1' }],
        },
      ]);
      expect(handler.emptyBackCount).toBe(1);
    });

    it('delivers no sub-deck when every card in it is blank', async () => {
      const tree: Record<string, FakeBlock[]> = {};
      tree[PARENT_PAGE] = [toggle('t-Chapter', 'Chapter')];
      tree['t-Chapter'] = [
        emptyToggle('t-Q1', 'Q1'),
        emptyToggle('t-Q2', 'Q2'),
      ];
      const handler = makeHandler(parentOnly(tree), true);
      const decks = await convert(handler, toggleSubDeckRules());

      expect(delivered(decks).map((deck) => deck.name)).toEqual(['Parent']);
      expect(handler.emptyBackCount).toBe(2);
    });

    it('still rescues a sub-deck of blank toggles from its headings', async () => {
      const tree: Record<string, FakeBlock[]> = {};
      tree[PARENT_PAGE] = [toggle('t-Chapter', 'Chapter')];
      tree['t-Chapter'] = [
        emptyToggle('t-Q1', 'Q1'),
        heading('h1', 'Cells'),
        paragraph('p1', 'Cells are the basic unit of life.'),
        heading('h2', 'Tissues'),
        paragraph('p2', 'Tissues are groups of similar cells.'),
        heading('h3', 'Organs'),
        paragraph('p3', 'Organs are groups of tissues.'),
      ];
      const handler = makeHandler(parentOnly(tree), true);
      const decks = await convert(handler, toggleSubDeckRules());

      expect(
        delivered(decks).map((deck) => [
          deck.name,
          deck.cards.map((card) => card.name),
        ])
      ).toEqual([
        ['Parent', ['Chapter']],
        ['Parent::Chapter', ['Cells', 'Tissues', 'Organs']],
      ]);
      expect(handler.emptyBackCount).toBe(0);
    });

    it('drops an empty toggle in the sub-deck with the Notion link option on', async () => {
      const tree: Record<string, FakeBlock[]> = {};
      tree[PARENT_PAGE] = [toggle('t-Chapter', 'Chapter')];
      tree['t-Chapter'] = [
        toggleWithBullets(tree, 't-Q1', 'Q1'),
        emptyToggle('t-Q2', 'Q2'),
      ];
      const handler = makeHandler(parentOnly(tree), true, LINK_ON);
      const decks = await convert(handler, toggleSubDeckRules());

      expect(delivered(decks)[1]).toEqual({
        name: 'Parent::Chapter',
        cards: [
          {
            name: 'Q1',
            back: backOf('t-Q1', 'Q1') + linkTo(PARENT_PAGE, 't-Q1'),
            notionId: 't-Q1',
          },
        ],
      });
    });

    it('drops the blank reverse companions with basic and reversed on', async () => {
      const tree: Record<string, FakeBlock[]> = {};
      tree[PARENT_PAGE] = [toggle('t-Chapter', 'Chapter')];
      tree['t-Chapter'] = [
        toggleWithBullets(tree, 't-Q1', 'Q1'),
        emptyToggle('t-Q2', 'Q2'),
      ];
      const handler = makeHandler(parentOnly(tree), true, {
        'basic-reversed': 'true',
      });
      const decks = await convert(handler, toggleSubDeckRules());

      expect(delivered(decks)[1]).toEqual({
        name: 'Parent::Chapter',
        cards: [
          { name: 'Q1', back: backOf('t-Q1', 'Q1'), notionId: 't-Q1' },
          { name: backOf('t-Q1', 'Q1'), back: 'Q1', notionId: undefined },
        ],
      });
    });

    it('drops a blank toggle swapped onto the front with the reversed option on', async () => {
      const tree: Record<string, FakeBlock[]> = {};
      tree[PARENT_PAGE] = [toggle('t-Chapter', 'Chapter')];
      tree['t-Chapter'] = [
        toggleWithBullets(tree, 't-Q1', 'Q1'),
        emptyToggle('t-Q2', 'Q2'),
      ];
      const handler = makeHandler(parentOnly(tree), true, { reversed: 'true' });
      const decks = await convert(handler, toggleSubDeckRules());

      expect(delivered(decks)[1]).toEqual({
        name: 'Parent::Chapter',
        cards: [{ name: backOf('t-Q1', 'Q1'), back: 'Q1', notionId: 't-Q1' }],
      });
    });

    it('keeps a typed-answer toggle with no answer', async () => {
      const tree: Record<string, FakeBlock[]> = {};
      tree[PARENT_PAGE] = [toggle('t-Chapter', 'Chapter')];
      tree['t-Chapter'] = [
        block(
          't-Input',
          'toggle',
          {
            rich_text: [
              ...richText('Capital of France: '),
              ...richText('Paris', { bold: true }),
            ],
            color: 'default',
          },
          false
        ),
        emptyToggle('t-Q2', 'Q2'),
      ];
      const handler = makeHandler(parentOnly(tree), true, {
        'enable-input': 'true',
        cloze: 'false',
      });
      const decks = await convert(handler, toggleSubDeckRules());

      expect(
        delivered(decks)[1].cards.map((card) => [card.name, card.notionId])
      ).toEqual([['Capital of France: ', 't-Input']]);
    });

    it('keeps a cloze toggle with no answer', async () => {
      const tree: Record<string, FakeBlock[]> = {};
      tree[PARENT_PAGE] = [toggle('t-Chapter', 'Chapter')];
      tree['t-Chapter'] = [
        block(
          't-Cloze',
          'toggle',
          {
            rich_text: [
              ...richText('Mitochondria is the '),
              ...richText('powerhouse', { code: true }),
            ],
            color: 'default',
          },
          false
        ),
        emptyToggle('t-Q2', 'Q2'),
      ];
      const handler = makeHandler(parentOnly(tree), true);
      const decks = await convert(handler, toggleSubDeckRules());

      expect(delivered(decks)[1]).toEqual({
        name: 'Parent::Chapter',
        cards: [
          {
            name: 'Mitochondria is the {{c1::powerhouse}}',
            back: '',
            notionId: 't-Cloze',
          },
        ],
      });
    });
  });

  describe('a toggle sub-deck on a free conversion', () => {
    it('builds no sub-deck', async () => {
      const tree: Record<string, FakeBlock[]> = {};
      tree[PARENT_PAGE] = [toggle('t-Chapter', 'Chapter')];
      tree['t-Chapter'] = [
        toggleWithBullets(tree, 't-Q1', 'Q1'),
        emptyToggle('t-Q2', 'Q2'),
      ];
      const handler = makeHandler(parentOnly(tree), false);
      const decks = await convert(handler, toggleSubDeckRules());

      expect(delivered(decks).map((deck) => deck.name)).toEqual(['Parent']);
    });
  });

  describe('deck rules without page on a paid conversion', () => {
    it('links a child page card to the child page, anchored to its block, with the Notion link option on', async () => {
      const tree: Record<string, FakeBlock[]> = {};
      tree[PARENT_PAGE] = [childPage(CHILD_PAGE, 'Child')];
      tree[CHILD_PAGE] = [toggleWithBullets(tree, 't-Q1', 'Q1')];
      const sdk = makeSdk(tree, {
        [PARENT_PAGE]: page(PARENT_PAGE, 'Parent'),
        [CHILD_PAGE]: page(CHILD_PAGE, 'Child'),
      });
      const rules = new ParserRules();
      rules.setDeckTypes(['database']);
      const decks = await convert(makeHandler(sdk, true, LINK_ON), rules);

      expect(delivered(decks)).toEqual([
        {
          name: 'Parent::Child',
          cards: [
            {
              name: 'Q1',
              back: backOf('t-Q1', 'Q1') + linkTo(CHILD_PAGE, 't-Q1'),
              notionId: 't-Q1',
            },
          ],
        },
      ]);
    });

    it('drops a blank toggle from the child page deck', async () => {
      const tree: Record<string, FakeBlock[]> = {};
      tree[PARENT_PAGE] = [childPage(CHILD_PAGE, 'Child')];
      tree[CHILD_PAGE] = [
        toggleWithBullets(tree, 't-Q1', 'Q1'),
        emptyToggle('t-Q2', 'Q2'),
      ];
      const sdk = makeSdk(tree, {
        [PARENT_PAGE]: page(PARENT_PAGE, 'Parent'),
        [CHILD_PAGE]: page(CHILD_PAGE, 'Child'),
      });
      const rules = new ParserRules();
      rules.setDeckTypes(['database']);
      const handler = makeHandler(sdk, true);
      const decks = await convert(handler, rules);

      expect(delivered(decks)).toEqual([
        {
          name: 'Parent::Child',
          cards: [{ name: 'Q1', back: backOf('t-Q1', 'Q1'), notionId: 't-Q1' }],
        },
      ]);
    });
  });

  describe('deck rules with page plus toggle on a paid conversion', () => {
    it('drops a blank toggle from the toggle deck', async () => {
      const tree: Record<string, FakeBlock[]> = {};
      tree[PARENT_PAGE] = [toggle('t-Unit', 'Unit')];
      tree['t-Unit'] = [
        toggleWithBullets(tree, 't-Q1', 'Q1'),
        emptyToggle('t-Q2', 'Q2'),
      ];
      const rules = new ParserRules();
      rules.setDeckTypes(['page', 'database', 'toggle']);
      const handler = makeHandler(parentOnly(tree), true);
      const decks = await convert(handler, rules);

      expect(delivered(decks)).toEqual([
        {
          name: 'Parent::Unit',
          cards: [{ name: 'Q1', back: backOf('t-Q1', 'Q1'), notionId: 't-Q1' }],
        },
      ]);
    });

    it('delivers no card and reads the empty answers reason when the toggle deck holds only blank toggles', async () => {
      const tree: Record<string, FakeBlock[]> = {};
      tree[PARENT_PAGE] = [toggle('t-Unit', 'Unit')];
      tree['t-Unit'] = [emptyToggle('t-Q1', 'Q1'), emptyToggle('t-Q2', 'Q2')];
      const rules = new ParserRules();
      rules.setDeckTypes(['page', 'database', 'toggle']);
      const handler = makeHandler(parentOnly(tree), true);
      const decks = await convert(handler, rules);

      expect(delivered(decks)).toEqual([]);
      expect(handler.emptyDeckReason()).toBe('empty_answers');
    });
  });
});
