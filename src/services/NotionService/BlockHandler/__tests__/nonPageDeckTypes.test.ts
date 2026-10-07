import { vi } from 'vitest';
import BlockHandler from '../BlockHandler';
import NotionAPIWrapper from '../../NotionAPIWrapper';
import CustomExporter from '../../../../lib/parser/exporters/CustomExporter';
import CardOption from '../../../../lib/parser/Settings';
import ParserRules from '../../../../lib/parser/ParserRules';

vi.mock('../../../../lib/parser/exporters/CustomExporter');

const TS = '2026-01-01T00:00:00.000Z';

interface FakeBlock {
  object: 'block';
  id: string;
  type: string;
  has_children: boolean;
  created_time: string;
  last_edited_time: string;
  [key: string]: unknown;
}

function richText(content: string) {
  return [
    {
      type: 'text',
      text: { content, link: null },
      plain_text: content,
      href: null,
      annotations: {
        bold: false,
        italic: false,
        strikethrough: false,
        underline: false,
        code: false,
        color: 'default',
      },
    },
  ];
}

function toggle(id: string, summary: string, hasChildren = false): FakeBlock {
  return {
    object: 'block',
    id,
    type: 'toggle',
    has_children: hasChildren,
    created_time: TS,
    last_edited_time: TS,
    toggle: { rich_text: richText(summary), color: 'default' },
  };
}

function buildApi(
  blocksByParent: Record<string, FakeBlock[]>
): NotionAPIWrapper {
  const api = {
    getPage: vi.fn(async (id: string) => ({
      id,
      object: 'page',
      created_time: TS,
      last_edited_time: TS,
      url: `https://notion.so/${id}`,
      properties: {},
    })),
    getTopLevelTags: vi.fn(async () => []),
    getPageTitle: vi.fn(async () => 'Root page'),
    getBlocks: vi.fn(async ({ id }: { id: string }) => ({
      results: blocksByParent[id] ?? [],
    })),
  };
  return api as unknown as NotionAPIWrapper;
}

function newHandler(api: NotionAPIWrapper, settings: CardOption): BlockHandler {
  const exporter = new CustomExporter('', '/tmp');
  const handler = new BlockHandler(exporter, api, settings);
  handler.useAll = true;
  return handler;
}

function rulesWithDeckTypes(deckTypes: string[]): ParserRules {
  const rules = new ParserRules();
  rules.setDeckTypes(deckTypes);
  return rules;
}

function settingsWithSplit(splitSectionsIntoDecks: boolean): CardOption {
  return new CardOption({
    ...CardOption.LoadDefaultOptions(),
    'split-sections-into-decks': splitSectionsIntoDecks ? 'true' : 'false',
  });
}

function heading(id: string, text: string, hasChildren = true): FakeBlock {
  return {
    object: 'block',
    id,
    type: 'heading_1',
    has_children: hasChildren,
    created_time: TS,
    last_edited_time: TS,
    heading_1: { rich_text: richText(text), color: 'default' },
  };
}

describe('findFlashcardsFromPage non-page deck types', () => {
  it('turns a toggle into a top-level deck sourced from its children', async () => {
    const childCard = toggle('child-card', 'Question on the toggle');
    const deckToggle = toggle('deck-toggle', 'My toggle deck', true);
    const api = buildApi({
      root: [deckToggle],
      'deck-toggle': [childCard],
    });
    const settings = settingsWithSplit(true);
    const handler = newHandler(api, settings);

    const decks = await handler.findFlashcardsFromPage({
      parentType: 'page',
      topLevelId: 'root',
      rules: rulesWithDeckTypes(['page', 'database', 'toggle']),
      decks: [],
      parentName: '',
    });

    const toggleDeck = decks.find((d) => d.name.includes('My toggle deck'));
    expect(toggleDeck).toBeDefined();
    expect(toggleDeck?.cards.map((c) => c.name)).toEqual([
      'Question on the toggle',
    ]);
  });

  it.each([
    ['heading_1', 'heading_1'],
    ['heading_2', 'heading_2'],
    ['heading_3', 'heading_3'],
    ['bulleted_list_item', 'bulleted_list_item'],
    ['numbered_list_item', 'numbered_list_item'],
  ])(
    'turns a %s block into a top-level deck sourced from its children',
    async (deckType) => {
      const childCard = toggle('child-card', 'Inner question');
      const deckBlock: FakeBlock = {
        object: 'block',
        id: 'deck-block',
        type: deckType,
        has_children: true,
        created_time: TS,
        last_edited_time: TS,
        [deckType]: { rich_text: richText('Section title'), color: 'default' },
      };
      const api = buildApi({
        root: [deckBlock],
        'deck-block': [childCard],
      });
      const settings = settingsWithSplit(true);
      const handler = newHandler(api, settings);

      const decks = await handler.findFlashcardsFromPage({
        parentType: 'page',
        topLevelId: 'root',
        rules: rulesWithDeckTypes(['page', 'database', deckType]),
        decks: [],
        parentName: '',
      });

      const deck = decks.find((d) => d.name.includes('Section title'));
      expect(deck).toBeDefined();
      expect(deck?.cards.map((c) => c.name)).toEqual(['Inner question']);
    }
  );

  it('lets DECK win over FLASHCARD when a type is in both', async () => {
    const childCard = toggle('child-card', 'Child question');
    const deckToggle = toggle('deck-toggle', 'Toggle as deck', true);
    const api = buildApi({
      root: [deckToggle],
      'deck-toggle': [childCard],
    });
    const settings = settingsWithSplit(true);
    const handler = newHandler(api, settings);

    const rules = rulesWithDeckTypes(['page', 'database', 'toggle']);
    rules.setFlashcardTypes(['toggle']);

    const decks = await handler.findFlashcardsFromPage({
      parentType: 'page',
      topLevelId: 'root',
      rules,
      decks: [],
      parentName: '',
    });

    const rootDeck = decks.find((d) => d.name === 'Root page');
    expect(rootDeck?.cards.map((c) => c.name)).toEqual([]);
    const toggleDeck = decks.find((d) => d.name.includes('Toggle as deck'));
    expect(toggleDeck?.cards.map((c) => c.name)).toEqual(['Child question']);
  });

  it('default deck_is of page,database produces no extra decks from a toggle', async () => {
    const childCard = toggle('child-card', 'Child question');
    const deckToggle = toggle('deck-toggle', 'A toggle', true);
    const api = buildApi({
      root: [deckToggle],
      'deck-toggle': [childCard],
    });
    const settings = settingsWithSplit(false);
    const handler = newHandler(api, settings);

    const decks = await handler.findFlashcardsFromPage({
      parentType: 'page',
      topLevelId: 'root',
      rules: new ParserRules(),
      decks: [],
      parentName: '',
    });

    expect(decks.map((d) => d.name)).toEqual(['Root page']);
    const rootDeck = decks[0];
    expect(rootDeck.cards.map((c) => c.name)).toEqual(['A toggle']);
  });

  it('splits two headings into separate decks from deck_is even when split-sections-into-decks is off', async () => {
    const firstCard = toggle('card-1', 'German question');
    const secondCard = toggle('card-2', 'Maths question');
    const germanHeading = heading('german', 'German');
    const mathsHeading = heading('maths', 'Maths');
    const api = buildApi({
      root: [germanHeading, mathsHeading],
      german: [firstCard],
      maths: [secondCard],
    });
    const handler = newHandler(api, settingsWithSplit(false));

    const decks = await handler.findFlashcardsFromPage({
      parentType: 'page',
      topLevelId: 'root',
      rules: rulesWithDeckTypes(['page', 'database', 'heading_1']),
      decks: [],
      parentName: '',
    });

    const germanDeck = decks.find((d) => d.name.includes('German'));
    const mathsDeck = decks.find((d) => d.name.includes('Maths'));
    expect(germanDeck?.cards.map((c) => c.name)).toEqual(['German question']);
    expect(mathsDeck?.cards.map((c) => c.name)).toEqual(['Maths question']);
  });

  it('splits two headings into separate top-level decks when the option is on', async () => {
    const firstCard = toggle('card-1', 'German question');
    const secondCard = toggle('card-2', 'Maths question');
    const germanHeading = heading('german', 'German');
    const mathsHeading = heading('maths', 'Maths');
    const api = buildApi({
      root: [germanHeading, mathsHeading],
      german: [firstCard],
      maths: [secondCard],
    });
    const handler = newHandler(api, settingsWithSplit(true));

    const decks = await handler.findFlashcardsFromPage({
      parentType: 'page',
      topLevelId: 'root',
      rules: rulesWithDeckTypes(['page', 'database', 'heading_1']),
      decks: [],
      parentName: '',
    });

    const germanDeck = decks.find((d) => d.name.includes('German'));
    const mathsDeck = decks.find((d) => d.name.includes('Maths'));
    expect(germanDeck?.cards.map((c) => c.name)).toEqual(['German question']);
    expect(mathsDeck?.cards.map((c) => c.name)).toEqual(['Maths question']);
  });
});
