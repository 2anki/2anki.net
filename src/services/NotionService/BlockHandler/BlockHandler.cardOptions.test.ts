import { vi } from 'vitest';
import BlockHandler from './BlockHandler';
import CardOption from '../../../lib/parser/Settings/CardOption';
import CustomExporter from '../../../lib/parser/exporters/CustomExporter';
import ParserRules from '../../../lib/parser/ParserRules';
import Workspace from '../../../lib/parser/WorkSpace';
import NotionAPIWrapper from '../NotionAPIWrapper';
import { setupTests } from '../../../test/configure-jest';

beforeEach(() => setupTests());

const TIME = '2026-01-01T00:00:00.000Z';

function richText(content: string, bold = false) {
  return [
    {
      type: 'text',
      text: { content, link: null },
      plain_text: content,
      href: null,
      annotations: {
        bold,
        italic: false,
        strikethrough: false,
        underline: false,
        code: false,
        color: 'default',
      },
    },
  ];
}

function baseBlock(id: string, type: string, hasChildren: boolean) {
  return {
    object: 'block',
    id,
    type,
    has_children: hasChildren,
    created_time: TIME,
    last_edited_time: TIME,
    archived: false,
    in_trash: false,
    parent: { type: 'page_id', page_id: 'page-1' },
  };
}

function plainToggle(id: string, text: string) {
  return {
    ...baseBlock(id, 'toggle', true),
    toggle: { rich_text: richText(text), color: 'default' },
  };
}

function headingBlock(id: string, text: string) {
  return {
    ...baseBlock(id, 'heading_1', true),
    heading_1: { rich_text: richText(text), color: 'default' },
  };
}

function bullet(id: string, text: string, bold = false) {
  return {
    ...baseBlock(id, 'bulleted_list_item', false),
    bulleted_list_item: { rich_text: richText(text, bold), color: 'default' },
  };
}

function buildApi(
  children: Record<string, unknown[]>,
  title: string
): NotionAPIWrapper {
  return {
    getPage: vi.fn(async () => ({
      id: 'page-1',
      object: 'page',
      created_time: TIME,
      last_edited_time: TIME,
      url: 'https://notion.so/page-1',
      properties: {},
    })),
    getPageTitle: vi.fn(async () => title),
    getTopLevelTags: vi.fn(async () => []),
    getBlocks: vi.fn(async ({ id }: { id: string }) => ({
      results: children[id] ?? [],
      has_more: false,
    })),
  } as unknown as NotionAPIWrapper;
}

async function convert(
  children: Record<string, unknown[]>,
  options: Record<string, string>,
  title = 'Study page'
) {
  const api = buildApi(children, title);
  const settings = new CardOption(options);
  const exporter = new CustomExporter('', new Workspace(true, 'fs').location);
  const bl = new BlockHandler(exporter, api, settings);
  return bl.findFlashcards({
    parentType: 'page',
    topLevelId: 'page-1',
    rules: new ParserRules(),
    decks: [],
    parentName: '',
  });
}

async function convertSubDecks(
  children: Record<string, unknown[]>,
  options: Record<string, string>
) {
  const api = buildApi(children, 'Root page');
  const settings = new CardOption({
    ...CardOption.LoadDefaultOptions(),
    'split-sections-into-decks': 'true',
    ...options,
  });
  const exporter = new CustomExporter('', new Workspace(true, 'fs').location);
  const bl = new BlockHandler(exporter, api, settings);
  bl.useAll = true;
  const rules = new ParserRules();
  rules.setDeckTypes(['page', 'database', 'heading_1']);
  return bl.findFlashcardsFromPage({
    parentType: 'page',
    topLevelId: 'page-1',
    rules,
    decks: [],
    parentName: '',
  });
}

const numberedSection = {
  'page-1': [headingBlock('sec', '7. Section')],
  sec: [plainToggle('t1', 'Front text')],
  t1: [bullet('b1', 'Back text')],
};

const oneToggle = {
  'page-1': [plainToggle('t1', 'Front text')],
  t1: [bullet('b1', 'Back text')],
};

describe('BlockHandler reversed-only option', () => {
  it('swaps front and back in place when reversed-only is on', async () => {
    const decks = await convert(oneToggle, { reversed: 'true' });
    const cards = decks.flatMap((d) => d.cards);
    expect(cards).toHaveLength(1);
    expect(cards[0].name).toContain('Back text');
    expect(cards[0].name).not.toContain('Front text');
    expect(cards[0].back).toContain('Front text');
    expect(cards[0].back).not.toContain('Back text');
  });

  it('still adds a reversed companion for basic-and-reversed', async () => {
    const decks = await convert(oneToggle, { 'basic-reversed': 'true' });
    const cards = decks.flatMap((d) => d.cards);
    expect(cards).toHaveLength(2);
    expect(cards[0].name).toContain('Front text');
    expect(cards[1].name).toContain('Back text');
  });
});

describe('BlockHandler deck-name numbering option', () => {
  it('strips leading numbering from a derived sub-deck name when on', async () => {
    const decks = await convertSubDecks(numberedSection, {
      'remove-deck-name-numbering': 'true',
    });
    const subDeck = decks.find((d) => d.name.includes('Section'));
    expect(subDeck?.name).toBe('Root page::Section');
  });

  it('leaves the derived sub-deck name untouched when off', async () => {
    const decks = await convertSubDecks(numberedSection, {
      'remove-deck-name-numbering': 'false',
    });
    const subDeck = decks.find((d) => d.name.includes('Section'));
    expect(subDeck?.name).toBe('Root page::7. Section');
  });

  it('keeps a user-typed deck name as typed while stripping the derived sub-deck name', async () => {
    const decks = await convertSubDecks(numberedSection, {
      'remove-deck-name-numbering': 'true',
      deckName: '3. My Typed Deck',
    });
    const subDeck = decks.find((d) => d.name.includes('Section'));
    expect(subDeck?.name).toBe('3. My Typed Deck::Section');
  });
});

describe('BlockHandler bold-bullet MCQ option', () => {
  const quiz = {
    'page-1': [plainToggle('q1', 'What is the capital of France?')],
    q1: [
      bullet('o1', 'London'),
      bullet('o2', 'Paris', true),
      bullet('o3', 'Berlin'),
    ],
  };

  it('classifies a bold-bullet toggle as MCQ when MCQ is enabled', async () => {
    const decks = await convert(quiz, { 'mcq-enabled': 'true' });
    const cards = decks.flatMap((d) => d.cards);
    expect(cards).toHaveLength(1);
    expect(cards[0].mcq).toBe(true);
    expect(cards[0].options).toEqual(['London', 'Paris', 'Berlin']);
    expect(cards[0].correctIndices).toEqual([1]);
    expect(cards[0].back).toBe('');
  });

  it('leaves a bold-bullet toggle as a basic card when MCQ is off', async () => {
    const decks = await convert(quiz, {});
    const cards = decks.flatMap((d) => d.cards);
    expect(cards).toHaveLength(1);
    expect(cards[0].mcq).toBeFalsy();
    expect(cards[0].back).toContain('Paris');
  });
});

describe('BlockHandler card-option GUID stability', () => {
  it('keeps the notionId GUID source and deck name stable when every option is off', async () => {
    const decks = await convert(oneToggle, {}, '3. Cell Biology');
    const cards = decks.flatMap((d) => d.cards);
    expect(cards).toHaveLength(1);
    expect(cards[0].notionId).toBe('t1');
    expect(cards[0].mcq).toBeFalsy();
    expect(cards[0].name).toContain('Front text');
    expect(cards[0].back).toContain('Back text');
    expect(decks[0].name).toBe('3. Cell Biology');
  });
});
