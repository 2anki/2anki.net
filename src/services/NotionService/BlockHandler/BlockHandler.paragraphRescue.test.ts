import { vi } from 'vitest';
import BlockHandler from './BlockHandler';
import CardOption from '../../../lib/parser/Settings/CardOption';
import CustomExporter from '../../../lib/parser/exporters/CustomExporter';
import ParserRules from '../../../lib/parser/ParserRules';
import Workspace from '../../../lib/parser/WorkSpace';
import NotionAPIWrapper from '../NotionAPIWrapper';
import { setupTests } from '../../../test/configure-jest';
import type { RescueRule } from '../../../types/RescueCandidate';

beforeEach(() => setupTests());

function richText(content: string, bold = false) {
  return {
    type: 'text' as const,
    text: { content, link: null },
    annotations: {
      bold,
      italic: false,
      strikethrough: false,
      underline: false,
      code: false,
      color: 'default' as const,
    },
    plain_text: content,
    href: null,
  };
}

let blockCounter = 0;

function block(
  type: string,
  items: ReturnType<typeof richText>[],
  hasChildren = false
) {
  blockCounter += 1;
  return {
    object: 'block',
    id: `${type}-${blockCounter}`,
    parent: { type: 'page_id', page_id: 'page-1' },
    created_time: '',
    last_edited_time: '',
    created_by: { object: 'user', id: 'u' },
    last_edited_by: { object: 'user', id: 'u' },
    has_children: hasChildren,
    archived: false,
    in_trash: false,
    type,
    [type]: { rich_text: items, color: 'default' },
  };
}

function termParagraph(term: string, rest: string) {
  return block('paragraph', [richText(term, true), richText(rest)]);
}

function proseParagraphs() {
  return [
    termParagraph(
      'Osmosis',
      ' is water moving across a semi-permeable membrane.'
    ),
    termParagraph(
      'Diffusion',
      ' spreads particles from high to low concentration.'
    ),
    termParagraph(
      'Active transport',
      ' moves molecules against their gradient using energy.'
    ),
  ];
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
    getPage: vi.fn().mockImplementation((id: string) =>
      Promise.resolve({
        id,
        object: 'page',
        created_time: '',
        last_edited_time: '',
      })
    ),
    getPageTitle: vi.fn().mockResolvedValue('Study Notes'),
    getTopLevelTags: vi.fn().mockResolvedValue([]),
    getBlocks: vi
      .fn()
      .mockImplementation(({ id }: { id: string }) =>
        Promise.resolve(blockList(childrenById[id] ?? []))
      ),
  } as unknown as NotionAPIWrapper;
}

function childPage(id: string) {
  return {
    object: 'block',
    id,
    parent: { type: 'page_id', page_id: 'page-1' },
    created_time: '',
    last_edited_time: '',
    created_by: { object: 'user', id: 'u' },
    last_edited_by: { object: 'user', id: 'u' },
    has_children: true,
    archived: false,
    in_trash: false,
    type: 'child_page',
    child_page: { title: id },
  };
}

function makeHandler(api: NotionAPIWrapper, settings = new CardOption({})) {
  return new BlockHandler(
    new CustomExporter('', new Workspace(true, 'fs').location),
    api,
    settings
  );
}

function convertPage(handler: BlockHandler, rescueRule?: RescueRule) {
  return handler.findFlashcards({
    parentType: 'page',
    topLevelId: 'page-1',
    rules: new ParserRules(),
    decks: [],
    parentName: '',
    rescueRule,
  });
}

describe('Notion empty-deck paragraphs offer', () => {
  it('offers the paragraphs rule with sample cards on a page of plain paragraphs', async () => {
    const handler = makeHandler(makeApi({ 'page-1': proseParagraphs() }));

    const decks = await convertPage(handler);

    expect(decks.flatMap((deck) => deck.cards)).toHaveLength(0);
    expect(handler.emptyDeckReason()).toBe('no_toggles');
    expect(handler.rescueCandidates).toEqual([
      {
        rule: 'paragraphs',
        cards: 3,
        sample: [
          {
            front: 'Osmosis',
            back: 'Osmosis is water moving across a semi-permeable membrane.',
          },
          {
            front: 'Diffusion',
            back: 'Diffusion spreads particles from high to low concentration.',
          },
          {
            front: 'Active transport',
            back: 'Active transport moves molecules against their gradient using energy.',
          },
        ],
      },
    ]);
  });

  it('builds the paragraphs deck when the person picks that rule', async () => {
    const handler = makeHandler(makeApi({ 'page-1': proseParagraphs() }));

    const decks = await convertPage(handler, 'paragraphs');

    const cards = decks.flatMap((deck) => deck.cards);
    expect(cards.map((card) => card.name)).toEqual([
      '<strong>Osmosis</strong>',
      '<strong>Diffusion</strong>',
      '<strong>Active transport</strong>',
    ]);
    expect(cards[0].back).toContain('semi-permeable membrane');
    expect(handler.cardCount).toBe(3);
    expect(handler.inducedRule).toMatchObject({
      rule: 'paragraphs',
      outcome: 'rescue_chosen',
    });
    expect(handler.rescueCandidates).toEqual([]);
  });

  it('does not offer paragraphs when fewer than three would become cards', async () => {
    const handler = makeHandler(
      makeApi({ 'page-1': proseParagraphs().slice(0, 2) })
    );

    await convertPage(handler);

    expect(handler.rescueCandidates).toEqual([]);
  });

  it('leaves a page with toggles unchanged, even when a rule is sent', async () => {
    const toggle = block('toggle', [richText('What is osmosis?')], true);
    const api = makeApi({
      'page-1': [toggle, ...proseParagraphs()],
      [toggle.id]: [
        block('paragraph', [richText('Water crossing a membrane.')]),
      ],
    });
    const withoutRule = makeHandler(api);
    const withRule = makeHandler(api);

    const plain = await convertPage(withoutRule);
    const forged = await convertPage(withRule, 'paragraphs');

    const plainCards = plain.flatMap((deck) => deck.cards);
    const forgedCards = forged.flatMap((deck) => deck.cards);
    expect(plainCards).toHaveLength(1);
    expect(plainCards[0].name).toContain('What is osmosis?');
    expect(forgedCards.map((card) => [card.name, card.back])).toEqual(
      plainCards.map((card) => [card.name, card.back])
    );
    expect(withRule.inducedRule).toBeUndefined();
    expect(withRule.rescueCandidates).toEqual([]);
  });

  it('does not offer or build paragraphs when cherry pick limits the deck', async () => {
    const settings = new CardOption({ cherry: 'true' });
    const handler = makeHandler(
      makeApi({ 'page-1': proseParagraphs() }),
      settings
    );

    const decks = await convertPage(handler, 'paragraphs');

    expect(decks.flatMap((deck) => deck.cards)).toHaveLength(0);
    expect(handler.rescueCandidates).toEqual([]);
  });

  it('reads a page that returned no blocks as having no content', async () => {
    const handler = makeHandler(makeApi({ 'page-1': [] }));

    await convertPage(handler);

    expect(handler.emptyDeckReason()).toBe('no_content');
    expect(handler.rescueCandidates).toEqual([]);
  });
});

describe('Notion picked rescue rule across nested pages and sub-decks', () => {
  it('leaves a prose child page alone when the parent page makes toggle cards', async () => {
    const toggle = block('toggle', [richText('What is osmosis?')], true);
    const api = makeApi({
      'page-1': [toggle, childPage('child-1')],
      [toggle.id]: [
        block('paragraph', [richText('Water crossing a membrane.')]),
      ],
      'child-1': proseParagraphs(),
    });
    const handler = makeHandler(api);

    const decks = await convertPage(handler, 'paragraphs');

    const cards = decks.flatMap((deck) => deck.cards);
    expect(cards.map((card) => card.name)).toEqual([
      expect.stringContaining('What is osmosis?'),
    ]);
    expect(handler.inducedRule).toBeUndefined();
    expect(handler.cardCount).toBe(1);
  });

  it('still records the rejected structure when a picked rule is held back', async () => {
    const toggle = block('toggle', [richText('What is osmosis?')], true);
    const api = makeApi({
      'page-1': [toggle, childPage('child-1')],
      [toggle.id]: [
        block('paragraph', [richText('Water crossing a membrane.')]),
      ],
      'child-1': [
        block('heading_2', [richText('Only one heading here')]),
        ...proseParagraphs(),
      ],
    });
    const handler = makeHandler(api);

    await convertPage(handler, 'paragraphs');

    expect(handler.inducedRule).toMatchObject({
      rule: 'heading',
      outcome: 'rescue_rejected',
    });
  });

  it('builds the picked rule on every empty page when nothing else made cards', async () => {
    const api = makeApi({
      'page-1': [...proseParagraphs(), childPage('child-1')],
      'child-1': proseParagraphs(),
    });
    const handler = makeHandler(api);

    const decks = await convertPage(handler, 'paragraphs');

    expect(decks.map((deck) => deck.cards.length)).toEqual([3, 3]);
    expect(handler.cardCount).toBe(6);
    expect(handler.inducedRule).toMatchObject({
      rule: 'paragraphs',
      outcome: 'rescue_chosen',
    });
  });

  function chapterRules() {
    const rules = new ParserRules();
    rules.setDeckTypes(['page', 'heading_1']);
    return rules;
  }

  function chaptersApi() {
    const chapterA = block('heading_1', [richText('Chapter A')], true);
    const chapterB = block('heading_1', [richText('Chapter B')], true);
    return makeApi({
      'page-1': [chapterA, chapterB],
      [chapterA.id]: proseParagraphs().slice(0, 2),
      [chapterB.id]: proseParagraphs().slice(1, 3),
    });
  }

  function convertChapters(handler: BlockHandler, rescueRule?: RescueRule) {
    return handler.findFlashcards({
      parentType: 'page',
      topLevelId: 'page-1',
      rules: chapterRules(),
      decks: [],
      parentName: '',
      rescueRule,
    });
  }

  it('counts paragraphs across sub-decks on a paid walk so the offer matches the deck', async () => {
    const handler = makeHandler(chaptersApi());
    handler.useAll = true;

    await convertChapters(handler);

    expect(handler.rescueCandidates).toMatchObject([
      { rule: 'paragraphs', cards: 4 },
    ]);
  });

  it('builds as many cards as the paid-walk offer counted', async () => {
    const handler = makeHandler(chaptersApi());
    handler.useAll = true;

    const decks = await convertChapters(handler, 'paragraphs');

    expect(decks.flatMap((deck) => deck.cards)).toHaveLength(4);
    expect(handler.cardCount).toBe(4);
  });
});
