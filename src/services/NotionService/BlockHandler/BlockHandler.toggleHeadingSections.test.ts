import BlockHandler from './BlockHandler';
import CardOption from '../../../lib/parser/Settings/CardOption';
import CustomExporter from '../../../lib/parser/exporters/CustomExporter';
import ParserRules from '../../../lib/parser/ParserRules';
import Workspace from '../../../lib/parser/WorkSpace';
import NotionAPIWrapper from '../NotionAPIWrapper';
import { setupTests } from '../../../test/configure-jest';

beforeEach(() => setupTests());

const TIME = '2026-01-01T00:00:00.000Z';

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

function toggleHeading(id: string, level: 1 | 2, text: string) {
  const type = `heading_${level}`;
  return {
    ...baseBlock(id, type, true),
    [type]: {
      rich_text: richText(text),
      is_toggleable: true,
      color: 'default',
    },
  };
}

function plainToggle(id: string, text: string) {
  return {
    ...baseBlock(id, 'toggle', true),
    toggle: { rich_text: richText(text), color: 'default' },
  };
}

function bullet(id: string, text: string) {
  return {
    ...baseBlock(id, 'bulleted_list_item', false),
    bulleted_list_item: { rich_text: richText(text), color: 'default' },
  };
}

function buildApi(children: Record<string, unknown[]>): NotionAPIWrapper {
  return {
    getPage: jest.fn(async () => ({
      id: 'page-1',
      object: 'page',
      created_time: TIME,
      last_edited_time: TIME,
      url: 'https://notion.so/page-1',
      properties: {},
    })),
    getPageTitle: jest.fn(async () => 'Study page'),
    getTopLevelTags: jest.fn(async () => []),
    getBlocks: jest.fn(async ({ id }: { id: string }) => ({
      results: children[id] ?? [],
      has_more: false,
    })),
  } as unknown as NotionAPIWrapper;
}

function makeHandler(api: NotionAPIWrapper): BlockHandler {
  const settings = new CardOption({});
  const exporter = new CustomExporter('', new Workspace(true, 'fs').location);
  return new BlockHandler(exporter, api, settings);
}

async function findCards(children: Record<string, unknown[]>) {
  const api = buildApi(children);
  const bl = makeHandler(api);
  const decks = await bl.findFlashcards({
    parentType: 'page',
    topLevelId: 'page-1',
    rules: new ParserRules(),
    decks: [],
    parentName: '',
  });
  return decks.flatMap((d) => d.cards);
}

describe('toggle-heading sections', () => {
  it('cards the toggles nested under toggle-headings, not the wrapper heading', async () => {
    const cards = await findCards({
      'page-1': [toggleHeading('h1', 1, 'Chapter')],
      h1: [
        toggleHeading('h2a', 2, 'Part one'),
        toggleHeading('h2b', 2, 'Part two'),
      ],
      h2a: [
        plainToggle('t1', 'What is the APGAR score?'),
        plainToggle('t2', 'Second question'),
      ],
      h2b: [plainToggle('t3', 'Third question')],
      t1: [bullet('b1', 'A newborn assessment')],
      t2: [bullet('b2', 'Second answer')],
      t3: [bullet('b3', 'Third answer')],
    });

    expect(cards.map((c) => c.name)).toEqual([
      'What is the APGAR score?',
      'Second question',
      'Third question',
    ]);
  });

  it('keeps a toggle-heading with no nested toggles as a card', async () => {
    const cards = await findCards({
      'page-1': [toggleHeading('h1', 1, 'Definition heading')],
      h1: [bullet('b1', 'The definition body')],
    });

    expect(cards).toHaveLength(1);
    expect(cards[0].name).toContain('Definition heading');
  });

  it('leaves top-level plain toggles untouched', async () => {
    const cards = await findCards({
      'page-1': [plainToggle('t1', 'Top level question')],
      t1: [bullet('b1', 'Top level answer')],
    });

    expect(cards).toHaveLength(1);
    expect(cards[0].name).toContain('Top level question');
  });

  it('cards toggles under a single toggle-heading level', async () => {
    const cards = await findCards({
      'page-1': [
        toggleHeading('h2', 2, 'Section'),
        plainToggle('t0', 'Sibling question'),
      ],
      h2: [plainToggle('t1', 'Nested question')],
      t0: [bullet('b0', 'Sibling answer')],
      t1: [bullet('b1', 'Nested answer')],
    });

    expect(cards.map((c) => c.name).sort()).toEqual([
      'Nested question',
      'Sibling question',
    ]);
  });
});
