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
const textBlock = (
  id: string,
  type: string,
  text: string,
  hasChildren = false
) =>
  block(id, type, { rich_text: richText(text), color: 'default' }, hasChildren);
const childPage = (id: string, title: string) =>
  block(id, 'child_page', { title }, true);
const syncedOriginal = (id: string) =>
  block(id, 'synced_block', { synced_from: null }, true);
const syncedCopyOf = (id: string, sourceId: string) =>
  block(
    id,
    'synced_block',
    { synced_from: { type: 'block_id', block_id: sourceId } },
    true
  );

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

function bulletsUnder(
  tree: Record<string, FakeBlock[]>,
  parentId: string,
  ...texts: string[]
) {
  tree[parentId] = texts.map((text, index) =>
    bullet(`${parentId}-b${index + 1}`, text)
  );
}

function toggleWithBullets(
  tree: Record<string, FakeBlock[]>,
  id: string,
  front: string
): FakeBlock {
  bulletsUnder(tree, id, `${front} first`, `${front} second`);
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

function listOf(parentId: string, ...texts: string[]) {
  const items = texts
    .map(
      (text, index) =>
        `<li id="${parentId}-b${index + 1}" class=""><div>${text}</div></li>`
    )
    .join('');
  return `<ul id="${parentId}-b1" class="bulleted-list">${items}</ul>`;
}

function backOf(front: string) {
  return listOf(`t-${front}`, `${front} first`, `${front} second`);
}

function singleItemList(id: string, text: string) {
  return `<ul id="${id}" class="bulleted-list"><li id="${id}" class=""><div>${text}</div></li></ul>`;
}

function nestedToggleMarkup(id: string, front: string, body: string) {
  return `<ul id="${id}" class="toggle"><li><details><summary>${front}</summary><div>${body}</div></details></li></ul>`;
}

const toggleCard = (front: string) => ({
  name: front,
  back: backOf(front),
  notionId: `t-${front}`,
});

const PLANS = [
  ['paid', true],
  ['free', false],
] as const;

describe('BlockHandler list back rendered twice in one conversion', () => {
  describe.each(PLANS)(
    'nested toggle promotion on a %s conversion',
    (_plan, useAll) => {
      function pageWithNestedListToggle() {
        const tree: Record<string, FakeBlock[]> = {};
        tree[PARENT_PAGE] = [toggle('t-Outer', 'Outer')];
        tree['t-Outer'] = [toggleWithBullets(tree, 't-Inner', 'Inner')];
        return makeSdk(tree, { [PARENT_PAGE]: page(PARENT_PAGE, 'Parent') });
      }

      it('promotes a nested toggle whose back is only a list, with the list', async () => {
        const sdk = pageWithNestedListToggle();
        const handler = makeHandler(
          sdk,
          useAll,
          new CardOption({ 'promote-nested-toggles': 'true' })
        );
        const decks = await convert(handler);

        expect(delivered(decks)).toEqual([
          {
            name: 'Parent',
            cards: [
              {
                name: 'Outer',
                back: nestedToggleMarkup('t-Inner', 'Inner', backOf('Inner')),
                notionId: 't-Outer',
              },
              toggleCard('Inner'),
            ],
          },
        ]);
      });

      it('leaves the parent card unchanged with promotion off', async () => {
        const sdk = pageWithNestedListToggle();
        const decks = await convert(makeHandler(sdk, useAll));

        expect(delivered(decks)).toEqual([
          {
            name: 'Parent',
            cards: [
              {
                name: 'Outer',
                back: nestedToggleMarkup('t-Inner', 'Inner', backOf('Inner')),
                notionId: 't-Outer',
              },
            ],
          },
        ]);
      });
    }
  );

  describe.each(PLANS)(
    'two toggles showing the same synced list on a %s conversion',
    (_plan, useAll) => {
      it('delivers both toggles with the list on their backs', async () => {
        const tree: Record<string, FakeBlock[]> = {};
        tree[PARENT_PAGE] = [toggle('t-A', 'A'), toggle('t-B', 'B')];
        tree['t-A'] = [syncedOriginal('s-src')];
        tree['t-B'] = [syncedCopyOf('s-copy', 's-src')];
        bulletsUnder(tree, 's-src', 'shared one', 'shared two');
        const sdk = makeSdk(tree, {
          [PARENT_PAGE]: page(PARENT_PAGE, 'Parent'),
        });
        const handler = makeHandler(sdk, useAll);
        const decks = await convert(handler);

        const sharedBack =
          singleItemList('s-src-b1', 'shared one') +
          singleItemList('s-src-b2', 'shared two');
        expect(delivered(decks)).toEqual([
          {
            name: 'Parent',
            cards: [
              { name: 'A', back: sharedBack, notionId: 't-A' },
              { name: 'B', back: sharedBack, notionId: 't-B' },
            ],
          },
        ]);
        expect(handler.emptyBackCount).toBe(0);
      });
    }
  );

  describe('one back showing the same synced list twice', () => {
    it('shows the list beside the toggle and again inside the nested toggle', async () => {
      const tree: Record<string, FakeBlock[]> = {};
      tree[PARENT_PAGE] = [toggle('t-A', 'A')];
      tree['t-A'] = [syncedOriginal('s-src'), toggle('t-X', 'X')];
      tree['t-X'] = [syncedCopyOf('s-copy', 's-src')];
      bulletsUnder(tree, 's-src', 'shared');
      const sdk = makeSdk(tree, {
        [PARENT_PAGE]: page(PARENT_PAGE, 'Parent'),
      });
      const decks = await convert(makeHandler(sdk, false));

      const shared = singleItemList('s-src-b1', 'shared');
      expect(delivered(decks)).toEqual([
        {
          name: 'Parent',
          cards: [
            {
              name: 'A',
              back: shared + nestedToggleMarkup('t-X', 'X', shared),
              notionId: 't-A',
            },
          ],
        },
      ]);
    });
  });

  describe('a toggle sub-deck on a paid conversion', () => {
    it('delivers the sub-deck cards with their list backs', async () => {
      const tree: Record<string, FakeBlock[]> = {};
      tree[PARENT_PAGE] = [toggle('t-Chapter', 'Chapter')];
      tree['t-Chapter'] = ['Q1', 'Q2'].map((front) =>
        toggleWithBullets(tree, `t-${front}`, front)
      );
      const sdk = makeSdk(tree, {
        [PARENT_PAGE]: page(PARENT_PAGE, 'Parent'),
      });
      const rules = new ParserRules();
      rules.SUB_DECKS = ['toggle'];
      const decks = await convert(makeHandler(sdk, true), rules);

      expect(delivered(decks)).toEqual([
        {
          name: 'Parent',
          cards: [
            {
              name: 'Chapter',
              back:
                nestedToggleMarkup('t-Q1', 'Q1', backOf('Q1')) +
                nestedToggleMarkup('t-Q2', 'Q2', backOf('Q2')),
              notionId: 't-Chapter',
            },
          ],
        },
        {
          name: 'Parent::Chapter',
          cards: [toggleCard('Q1'), toggleCard('Q2')],
        },
      ]);
    });

    it('delivers a promoted nested toggle once, in the parent deck, when the sub-deck would repeat it', async () => {
      const tree: Record<string, FakeBlock[]> = {};
      tree[PARENT_PAGE] = [toggle('t-Chapter', 'Chapter')];
      tree['t-Chapter'] = [toggleWithBullets(tree, 't-Q1', 'Q1')];
      const sdk = makeSdk(tree, {
        [PARENT_PAGE]: page(PARENT_PAGE, 'Parent'),
      });
      const rules = new ParserRules();
      rules.SUB_DECKS = ['toggle'];
      const decks = await convert(
        makeHandler(
          sdk,
          true,
          new CardOption({ 'promote-nested-toggles': 'true' })
        ),
        rules
      );

      expect(delivered(decks)).toEqual([
        {
          name: 'Parent',
          cards: [
            {
              name: 'Chapter',
              back: nestedToggleMarkup('t-Q1', 'Q1', backOf('Q1')),
              notionId: 't-Chapter',
            },
            toggleCard('Q1'),
          ],
        },
      ]);
    });
  });

  describe('deck rules with page and toggle on a paid conversion', () => {
    function childPageWithToggleDeck(innerBullets: string[]) {
      const tree: Record<string, FakeBlock[]> = {};
      tree[PARENT_PAGE] = [childPage(CHILD_PAGE, 'Child')];
      tree[CHILD_PAGE] = [toggle('t-Unit', 'Unit')];
      tree['t-Unit'] = [toggle('t-Inner', 'Inner')];
      bulletsUnder(tree, 't-Inner', ...innerBullets);
      return makeSdk(tree, {
        [PARENT_PAGE]: page(PARENT_PAGE, 'Parent'),
        [CHILD_PAGE]: page(CHILD_PAGE, 'Child'),
      });
    }

    function pageAndToggleDecks() {
      const rules = new ParserRules();
      rules.setDeckTypes(['page', 'database', 'toggle']);
      return rules;
    }

    it('keeps the nested list on the back of the deck toggle carded by the second walk', async () => {
      const sdk = childPageWithToggleDeck(['Inner first', 'Inner second']);
      const decks = await convert(makeHandler(sdk, true), pageAndToggleDecks());

      expect(delivered(decks)).toEqual([
        {
          name: 'Parent::Unit',
          cards: [
            {
              name: 'Inner',
              back: listOf('t-Inner', 'Inner first', 'Inner second'),
              notionId: 't-Inner',
            },
          ],
        },
        {
          name: 'Parent::Child',
          cards: [
            {
              name: 'Unit',
              back: nestedToggleMarkup(
                't-Inner',
                'Inner',
                listOf('t-Inner', 'Inner first', 'Inner second')
              ),
              notionId: 't-Unit',
            },
          ],
        },
      ]);
    });

    it('skips the deck toggle with the avocado option when its nested list holds the avocado', async () => {
      const sdk = childPageWithToggleDeck(['plain item', 'skip me 🥑']);
      const decks = await convert(
        makeHandler(sdk, true, new CardOption({ avocado: 'true' })),
        pageAndToggleDecks()
      );

      expect(delivered(decks)).toEqual([]);
    });
  });

  describe.each(PLANS)(
    'a page that renders each block once on a %s conversion',
    (_plan, useAll) => {
      const todo = (id: string, text: string, checked: boolean) =>
        block(id, 'to_do', {
          rich_text: richText(text),
          color: 'default',
          checked,
        });

      function pageRenderedOnce() {
        const tree: Record<string, FakeBlock[]> = {};
        tree[PARENT_PAGE] = [
          textBlock('p-intro', 'paragraph', 'Intro text'),
          toggle('t-Mixed', 'Mixed'),
          toggle('t-Nested', 'Nested'),
          toggle('t-Columns', 'Columns'),
          textBlock('b-holder', 'bulleted_list_item', 'Holder', true),
        ];
        tree['t-Mixed'] = [
          textBlock('m-p', 'paragraph', 'Lead'),
          bullet('m-b1', 'alpha'),
          bullet('m-b2', 'beta'),
          block('m-h', 'heading_3', {
            rich_text: richText('Then'),
            color: 'default',
            is_toggleable: false,
          }),
          bullet('m-b3', 'gamma'),
          textBlock('m-n1', 'numbered_list_item', 'one'),
          textBlock('m-n2', 'numbered_list_item', 'two'),
          todo('m-d1', 'done', true),
          todo('m-d2', 'open', false),
        ];
        tree['t-Nested'] = [
          textBlock('n-b1', 'bulleted_list_item', 'outer', true),
          bullet('n-b2', 'sibling'),
        ];
        bulletsUnder(tree, 'n-b1', 'inner one', 'inner two');
        tree['t-Columns'] = [block('col-list', 'column_list', {}, true)];
        tree['col-list'] = [
          block('col-1', 'column', {}, true),
          block('col-2', 'column', {}, true),
        ];
        bulletsUnder(tree, 'col-1', 'left one', 'left two');
        bulletsUnder(tree, 'col-2', 'right one');
        tree['b-holder'] = [toggleWithBullets(tree, 't-Held', 'Held')];
        return makeSdk(tree, { [PARENT_PAGE]: page(PARENT_PAGE, 'Parent') });
      }

      it('delivers lists in toggles, nested lists, to-dos, columns and toggles in list items as before', async () => {
        const decks = await convert(makeHandler(pageRenderedOnce(), useAll));

        expect(delivered(decks)).toMatchInlineSnapshot(`
          [
            {
              "cards": [
                {
                  "back": "<p class="" id="m-p">Lead</p><ul id="m-b1" class="bulleted-list"><li id="m-b1" class=""><div>alpha</div></li><li id="m-b2" class=""><div>beta</div></li></ul><h3 id="m-h" class="">Then</h3><ul id="m-b3" class="bulleted-list"><li id="m-b3" class=""><div>gamma</div></li></ul><ol id="m-n1" class="numbered-list"><li id="m-n1" class=""><div>one</div></li><li id="m-n2" class=""><div>two</div></li></ol><ul id="m-d1" class="to-do-list"><li id="m-d1" class=""><div class="checkbox checkbox-on"></div><div>done</div></li><li id="m-d2" class=""><div class="checkbox checkbox-off"></div><div>open</div></li></ul>",
                  "name": "Mixed",
                  "notionId": "t-Mixed",
                },
                {
                  "back": "<ul id="n-b1" class="bulleted-list"><li id="n-b1" class=""><div>outer</div><div class=""><ul id="n-b1-b1" class="bulleted-list"><li id="n-b1-b1" class=""><div>inner one</div></li><li id="n-b1-b2" class=""><div>inner two</div></li></ul></div></li><li id="n-b2" class=""><div>sibling</div></li></ul>",
                  "name": "Nested",
                  "notionId": "t-Nested",
                },
                {
                  "back": "<ul id="col-1-b1" class="bulleted-list"><li id="col-1-b1" class=""><div>left one</div></li><li id="col-1-b2" class=""><div>left two</div></li></ul><ul id="col-2-b1" class="bulleted-list"><li id="col-2-b1" class=""><div>right one</div></li></ul>",
                  "name": "Columns",
                  "notionId": "t-Columns",
                },
                {
                  "back": "<ul id="t-Held-b1" class="bulleted-list"><li id="t-Held-b1" class=""><div>Held first</div></li><li id="t-Held-b2" class=""><div>Held second</div></li></ul>",
                  "name": "Held",
                  "notionId": "t-Held",
                },
              ],
              "name": "Parent",
            },
          ]
        `);
      });
    }
  );
});
