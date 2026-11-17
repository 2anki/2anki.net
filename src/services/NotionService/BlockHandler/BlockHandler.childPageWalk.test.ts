import { vi } from 'vitest';
import BlockHandler from './BlockHandler';
import CardOption from '../../../lib/parser/Settings/CardOption';
import CustomExporter from '../../../lib/parser/exporters/CustomExporter';
import ParserRules from '../../../lib/parser/ParserRules';
import Workspace from '../../../lib/parser/WorkSpace';
import Deck from '../../../lib/parser/Deck';
import NotionAPIWrapper from '../NotionAPIWrapper';
import { setupTests } from '../../../test/configure-jest';

beforeEach(() => setupTests());

const PARENT_PAGE = '11111111-1111-4111-8111-111111111111';
const CHILD_PAGE = '22222222-2222-4222-8222-222222222222';
const GRANDCHILD_PAGE = '33333333-3333-4333-8333-333333333333';
const EDITED = '2026-11-01T00:00:00.000Z';

type FakeBlock = Record<string, unknown> & { id: string };

function richText(text: string) {
  return [
    {
      type: 'text' as const,
      text: { content: text, link: null },
      annotations: {
        bold: false,
        italic: false,
        strikethrough: false,
        underline: false,
        code: false,
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

const toggle = (id: string, front: string) =>
  block(id, 'toggle', { rich_text: richText(front), color: 'default' }, true);
const bullet = (id: string, text: string) =>
  block(id, 'bulleted_list_item', {
    rich_text: richText(text),
    color: 'default',
  });
const childPage = (id: string, title: string) =>
  block(id, 'child_page', { title }, true);
const heading = (id: string, text: string) =>
  block(id, 'heading_2', {
    rich_text: richText(text),
    color: 'default',
    is_toggleable: false,
  });
const heading1 = (id: string, text: string) =>
  block(id, 'heading_1', {
    rich_text: richText(text),
    color: 'default',
    is_toggleable: false,
  });
const paragraph = (id: string, text: string) =>
  block(id, 'paragraph', { rich_text: richText(text), color: 'default' });

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

function makeHandler(
  sdk: ReturnType<typeof makeSdk>,
  useAll: boolean,
  settings = new CardOption({})
): BlockHandler {
  const api = new NotionAPIWrapper('test-token', '1');
  (api as unknown as { notion: unknown }).notion = sdk;
  const exporter = new CustomExporter('', new Workspace(true, 'fs').location);
  const handler = new BlockHandler(exporter, api, settings);
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

function childrenFetchesOf(sdk: ReturnType<typeof makeSdk>, id: string) {
  return sdk.blocks.children.list.mock.calls.filter(
    ([args]) => args.block_id === id
  ).length;
}

function backOf(front: string) {
  return `<ul id="t-${front}-b1" class="bulleted-list"><li id="t-${front}-b1" class=""><div>${front} first</div></li><li id="t-${front}-b2" class=""><div>${front} second</div></li></ul>`;
}

const CHILD_TOGGLES = ['Q1', 'Q2', 'Q3'];

function pageWithOneChildPage() {
  const tree: Record<string, FakeBlock[]> = {};
  tree[PARENT_PAGE] = [
    toggleWithBullets(tree, 't-P1', 'P1'),
    childPage(CHILD_PAGE, 'Child'),
  ];
  tree[CHILD_PAGE] = CHILD_TOGGLES.map((front) =>
    toggleWithBullets(tree, `t-${front}`, front)
  );
  const sdk = makeSdk(tree, {
    [PARENT_PAGE]: page(PARENT_PAGE, 'Parent'),
    [CHILD_PAGE]: page(CHILD_PAGE, 'Child'),
  });
  return { tree, sdk };
}

const EXPECTED_ONE_CHILD = [
  {
    name: 'Parent',
    cards: [{ name: 'P1', back: backOf('P1'), notionId: 't-P1' }],
  },
  {
    name: 'Parent::Child',
    cards: CHILD_TOGGLES.map((front) => ({
      name: front,
      back: backOf(front),
      notionId: `t-${front}`,
    })),
  },
];

describe('BlockHandler child page walk', () => {
  describe.each([
    ['paid', true],
    ['free', false],
  ])('a %s conversion of a page with one child page', (_plan, useAll) => {
    it('delivers the parent deck and the child deck with full backs', async () => {
      const { sdk } = pageWithOneChildPage();
      const decks = await convert(makeHandler(sdk, useAll));

      expect(delivered(decks)).toEqual(EXPECTED_ONE_CHILD);
    });

    it('counts each toggle once and no empty backs', async () => {
      const { sdk } = pageWithOneChildPage();
      const handler = makeHandler(sdk, useAll);
      await convert(handler);

      expect({
        blocksSeen: handler.blocksSeen,
        emptyBackCount: handler.emptyBackCount,
        cardCount: handler.cardCount,
      }).toEqual({ blocksSeen: 4, emptyBackCount: 0, cardCount: 4 });
    });

    it('fetches each child-page toggle body from Notion once', async () => {
      const { sdk } = pageWithOneChildPage();
      await convert(makeHandler(sdk, useAll));

      expect(
        CHILD_TOGGLES.map((front) => childrenFetchesOf(sdk, `t-${front}`))
      ).toEqual([1, 1, 1]);
    });

    it('lists the child page as often as the parent page', async () => {
      const { sdk } = pageWithOneChildPage();
      await convert(makeHandler(sdk, useAll));

      expect(childrenFetchesOf(sdk, CHILD_PAGE)).toBe(
        childrenFetchesOf(sdk, PARENT_PAGE)
      );
    });

    it('returns no empty deck for the child page', async () => {
      const { sdk } = pageWithOneChildPage();
      const decks = await convert(makeHandler(sdk, useAll));

      expect(decks.map((deck) => [deck.name, deck.cards.length])).toEqual([
        ['Parent', 1],
        ['Parent::Child', 3],
      ]);
    });
  });

  describe('nested child pages', () => {
    function pageWithNestedChildPages() {
      const tree: Record<string, FakeBlock[]> = {};
      tree[PARENT_PAGE] = [
        toggleWithBullets(tree, 't-P1', 'P1'),
        childPage(CHILD_PAGE, 'Child'),
      ];
      tree[CHILD_PAGE] = [
        toggleWithBullets(tree, 't-C1', 'C1'),
        childPage(GRANDCHILD_PAGE, 'Grandchild'),
      ];
      tree[GRANDCHILD_PAGE] = [toggleWithBullets(tree, 't-G1', 'G1')];
      return makeSdk(tree, {
        [PARENT_PAGE]: page(PARENT_PAGE, 'Parent'),
        [CHILD_PAGE]: page(CHILD_PAGE, 'Child'),
        [GRANDCHILD_PAGE]: page(GRANDCHILD_PAGE, 'Grandchild'),
      });
    }

    it.each([
      ['paid', true],
      ['free', false],
    ])('walks each page once on a %s conversion', async (_plan, useAll) => {
      const sdk = pageWithNestedChildPages();
      const handler = makeHandler(sdk, useAll);
      const decks = await convert(handler);

      expect(delivered(decks)).toEqual([
        {
          name: 'Parent',
          cards: [{ name: 'P1', back: backOf('P1'), notionId: 't-P1' }],
        },
        {
          name: 'Parent::Child',
          cards: [{ name: 'C1', back: backOf('C1'), notionId: 't-C1' }],
        },
        {
          name: 'Parent::Child::Grandchild',
          cards: [{ name: 'G1', back: backOf('G1'), notionId: 't-G1' }],
        },
      ]);
      expect({
        blocksSeen: handler.blocksSeen,
        emptyBackCount: handler.emptyBackCount,
        cardCount: handler.cardCount,
        toggleBodyFetches: ['t-P1', 't-C1', 't-G1'].map((id) =>
          childrenFetchesOf(sdk, id)
        ),
      }).toEqual({
        blocksSeen: 3,
        emptyBackCount: 0,
        cardCount: 3,
        toggleBodyFetches: [1, 1, 1],
      });
    });
  });

  describe('basic and reversed on a paid conversion', () => {
    it('delivers each reversed companion once', async () => {
      const { sdk } = pageWithOneChildPage();
      const handler = makeHandler(
        sdk,
        true,
        new CardOption({ 'basic-reversed': 'true' })
      );
      const decks = await convert(handler);

      expect(
        delivered(decks).map((deck) => [
          deck.name,
          deck.cards.map((card) => card.name),
        ])
      ).toEqual([
        ['Parent', ['P1', backOf('P1')]],
        [
          'Parent::Child',
          CHILD_TOGGLES.flatMap((front) => [front, backOf(front)]),
        ],
      ]);
    });
  });

  describe('table cards in a child page on a paid conversion', () => {
    it('delivers each table row once', async () => {
      const tree: Record<string, FakeBlock[]> = {};
      tree[PARENT_PAGE] = [childPage(CHILD_PAGE, 'Child')];
      tree[CHILD_PAGE] = [
        block(
          'tbl',
          'table',
          { table_width: 2, has_column_header: false, has_row_header: false },
          true
        ),
      ];
      tree['tbl'] = [
        block('row1', 'table_row', {
          cells: [richText('Mitochondria'), richText('Powerhouse')],
        }),
      ];
      const sdk = makeSdk(tree, {
        [PARENT_PAGE]: page(PARENT_PAGE, 'Parent'),
        [CHILD_PAGE]: page(CHILD_PAGE, 'Child'),
      });
      const rules = new ParserRules();
      rules.setFlashcardTypes(['toggle', 'table']);
      const decks = await convert(makeHandler(sdk, true), rules);

      expect(
        delivered(decks).map((deck) => [deck.name, deck.cards.length])
      ).toEqual([['Parent::Child', 1]]);
    });
  });

  describe('a child page whose toggles sit beside headings', () => {
    it('does not rescue a second deck from the headings on a paid conversion', async () => {
      const tree: Record<string, FakeBlock[]> = {};
      tree[PARENT_PAGE] = [childPage(CHILD_PAGE, 'Child')];
      tree[CHILD_PAGE] = [
        heading('h1', 'Cells'),
        paragraph('p1', 'Cells are the basic unit of life.'),
        toggleWithBullets(tree, 't-Q1', 'Q1'),
        heading('h2', 'Tissues'),
        paragraph('p2', 'Tissues are groups of similar cells.'),
        heading('h3', 'Organs'),
        paragraph('p3', 'Organs are groups of tissues.'),
      ];
      const sdk = makeSdk(tree, {
        [PARENT_PAGE]: page(PARENT_PAGE, 'Parent'),
        [CHILD_PAGE]: page(CHILD_PAGE, 'Child'),
      });
      const handler = makeHandler(sdk, true);
      const decks = await convert(handler);

      expect(delivered(decks)).toEqual([
        {
          name: 'Parent::Child',
          cards: [{ name: 'Q1', back: backOf('Q1'), notionId: 't-Q1' }],
        },
      ]);
      expect(handler.inducedRule).toBeUndefined();
    });
  });

  describe('a synced block in a child page on a paid conversion', () => {
    it('delivers the synced toggle once with its full back', async () => {
      const tree: Record<string, FakeBlock[]> = {};
      tree[PARENT_PAGE] = [childPage(CHILD_PAGE, 'Child')];
      tree[CHILD_PAGE] = [
        block('synced-src', 'synced_block', { synced_from: null }, true),
      ];
      tree['synced-src'] = [toggleWithBullets(tree, 't-Q1', 'Q1')];
      const sdk = makeSdk(tree, {
        [PARENT_PAGE]: page(PARENT_PAGE, 'Parent'),
        [CHILD_PAGE]: page(CHILD_PAGE, 'Child'),
      });
      const handler = makeHandler(sdk, true);
      const decks = await convert(handler);

      expect(delivered(decks)).toEqual([
        {
          name: 'Parent::Child',
          cards: [{ name: 'Q1', back: backOf('Q1'), notionId: 't-Q1' }],
        },
      ]);
      expect(handler.emptyBackCount).toBe(0);
    });
  });

  describe('a headings-only child page on a paid conversion', () => {
    it('rescues the child page exactly once', async () => {
      const tree: Record<string, FakeBlock[]> = {};
      tree[PARENT_PAGE] = [childPage(CHILD_PAGE, 'Child')];
      tree[CHILD_PAGE] = [
        heading('h1', 'Cells'),
        paragraph('p1', 'Cells are the basic unit of life.'),
        heading('h2', 'Tissues'),
        paragraph('p2', 'Tissues are groups of similar cells.'),
        heading('h3', 'Organs'),
        paragraph('p3', 'Organs are groups of tissues.'),
      ];
      const sdk = makeSdk(tree, {
        [PARENT_PAGE]: page(PARENT_PAGE, 'Parent'),
        [CHILD_PAGE]: page(CHILD_PAGE, 'Child'),
      });
      const decks = await convert(makeHandler(sdk, true));

      expect(
        delivered(decks).map((deck) => [
          deck.name,
          deck.cards.map((card) => card.name),
        ])
      ).toEqual([['Parent::Child', ['Cells', 'Tissues', 'Organs']]]);
    });
  });

  describe.each([
    ['database only', ['database'], []],
    ['heading_1 only', ['heading_1'], [heading1('h-intro', 'Intro')]],
  ])(
    'deck boundaries without page (%s) on a paid conversion',
    (_label, deckTypes, parentExtras) => {
      function pageOutsidePageDecks() {
        const tree: Record<string, FakeBlock[]> = {};
        tree[PARENT_PAGE] = [
          ...parentExtras,
          toggleWithBullets(tree, 't-P1', 'P1'),
          childPage(CHILD_PAGE, 'Child'),
        ];
        tree[CHILD_PAGE] = [
          heading1('h-child', 'Chapter'),
          ...CHILD_TOGGLES.map((front) =>
            toggleWithBullets(tree, `t-${front}`, front)
          ),
        ];
        return makeSdk(tree, {
          [PARENT_PAGE]: page(PARENT_PAGE, 'Parent'),
          [CHILD_PAGE]: page(CHILD_PAGE, 'Child'),
        });
      }

      function rulesWithDeckTypes() {
        const rules = new ParserRules();
        rules.setDeckTypes(deckTypes);
        return rules;
      }

      it('delivers the child page toggles once, with full backs and block-id guids', async () => {
        const sdk = pageOutsidePageDecks();
        const decks = await convert(
          makeHandler(sdk, true),
          rulesWithDeckTypes()
        );

        expect(delivered(decks)).toEqual([
          {
            name: 'Parent::Child',
            cards: CHILD_TOGGLES.map((front) => ({
              name: front,
              back: backOf(front),
              notionId: `t-${front}`,
            })),
          },
        ]);
      });

      it('counts each child page toggle once', async () => {
        const sdk = pageOutsidePageDecks();
        const handler = makeHandler(sdk, true);
        await convert(handler, rulesWithDeckTypes());

        expect({
          blocksSeen: handler.blocksSeen,
          emptyBackCount: handler.emptyBackCount,
          toggleBodyFetches: CHILD_TOGGLES.map((front) =>
            childrenFetchesOf(sdk, `t-${front}`)
          ),
        }).toEqual({
          blocksSeen: 3,
          emptyBackCount: 0,
          toggleBodyFetches: [1, 1, 1],
        });
      });
    }
  );

  describe('custom sub-deck rules', () => {
    function pageWithToggleSubDeck() {
      const tree: Record<string, FakeBlock[]> = {};
      tree['t-Chapter'] = CHILD_TOGGLES.map((front) =>
        toggleWithBullets(tree, `t-${front}`, front)
      );
      tree[PARENT_PAGE] = [
        toggle('t-Chapter', 'Chapter'),
        childPage(CHILD_PAGE, 'Child'),
      ];
      tree[CHILD_PAGE] = [toggleWithBullets(tree, 't-C1', 'C1')];
      return makeSdk(tree, {
        [PARENT_PAGE]: page(PARENT_PAGE, 'Parent'),
        [CHILD_PAGE]: page(CHILD_PAGE, 'Child'),
      });
    }

    it('still builds a toggle sub-deck when SUB_DECKS names toggle instead of child_page', async () => {
      const sdk = pageWithToggleSubDeck();
      const rules = new ParserRules();
      rules.SUB_DECKS = ['toggle'];
      const handler = makeHandler(sdk, true);
      const decks = await convert(handler, rules);

      expect(
        delivered(decks).map((deck) => [
          deck.name,
          deck.cards.map((card) => card.name),
        ])
      ).toEqual([
        ['Parent', ['Chapter']],
        ['Parent::Child', ['C1']],
        ['Parent::Chapter', CHILD_TOGGLES],
      ]);
    });

    it('still builds a toggle sub-deck beside the child page when SUB_DECKS names both', async () => {
      const sdk = pageWithToggleSubDeck();
      const rules = new ParserRules();
      rules.SUB_DECKS = ['child_page', 'toggle'];
      const handler = makeHandler(sdk, true);
      const decks = await convert(handler, rules);

      expect(
        delivered(decks).map((deck) => [
          deck.name,
          deck.cards.map((card) => card.name),
        ])
      ).toEqual([
        ['Parent', ['Chapter']],
        ['Parent::Child', ['C1']],
        ['Parent::Chapter', CHILD_TOGGLES],
      ]);
    });

    it('still builds a heading sub-deck beside the child page when SUB_DECKS names heading_1', async () => {
      const tree: Record<string, FakeBlock[]> = {};
      tree[PARENT_PAGE] = [
        block(
          'h-Unit',
          'heading_1',
          {
            rich_text: richText('Unit'),
            color: 'default',
            is_toggleable: true,
          },
          true
        ),
        childPage(CHILD_PAGE, 'Child'),
      ];
      tree['h-Unit'] = [
        paragraph('p-unit', 'Unit summary'),
        toggleWithBullets(tree, 't-U1', 'U1'),
      ];
      tree[CHILD_PAGE] = [toggleWithBullets(tree, 't-C1', 'C1')];
      const sdk = makeSdk(tree, {
        [PARENT_PAGE]: page(PARENT_PAGE, 'Parent'),
        [CHILD_PAGE]: page(CHILD_PAGE, 'Child'),
      });
      const rules = new ParserRules();
      rules.SUB_DECKS = ['child_page', 'heading_1'];
      const decks = await convert(makeHandler(sdk, true), rules);

      expect(
        delivered(decks).map((deck) => [
          deck.name,
          deck.cards.map((card) => card.name),
        ])
      ).toEqual([
        ['Parent', ['U1']],
        ['Parent::Child', ['C1']],
      ]);
      expect(childrenFetchesOf(sdk, 'h-Unit')).toBe(2);
    });

    it('fetches the child page no more often when SUB_DECKS adds child_page to toggle', async () => {
      const fetchesWith = async (subDecks: string[]) => {
        const sdk = pageWithToggleSubDeck();
        const rules = new ParserRules();
        rules.SUB_DECKS = subDecks;
        await convert(makeHandler(sdk, true), rules);
        return [CHILD_PAGE, 't-C1'].map((id) => childrenFetchesOf(sdk, id));
      };

      expect(await fetchesWith(['child_page', 'toggle'])).toEqual(
        await fetchesWith(['toggle'])
      );
    });
  });
});
