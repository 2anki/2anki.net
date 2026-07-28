import BlockHandler from './BlockHandler';
import CardOption from '../../../lib/parser/Settings/CardOption';
import CustomExporter from '../../../lib/parser/exporters/CustomExporter';
import ParserRules from '../../../lib/parser/ParserRules';
import Workspace from '../../../lib/parser/WorkSpace';
import NotionAPIWrapper from '../NotionAPIWrapper';
import { setupTests } from '../../../test/configure-jest';

beforeEach(() => setupTests());

function richText(content: string) {
  return {
    type: 'text' as const,
    text: { content, link: null },
    annotations: {
      bold: false,
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

function block(type: string, content: string) {
  return {
    object: 'block',
    id: `${type}-${content.slice(0, 8)}`,
    parent: { type: 'page_id', page_id: 'page-1' },
    created_time: '',
    last_edited_time: '',
    created_by: { object: 'user', id: 'u' },
    last_edited_by: { object: 'user', id: 'u' },
    has_children: false,
    archived: false,
    in_trash: false,
    type,
    [type]: { rich_text: [richText(content)], color: 'default' },
  };
}

function makeApi(blocks: unknown[]): NotionAPIWrapper {
  return {
    getPage: jest.fn().mockResolvedValue({
      id: 'page-1',
      object: 'page',
      created_time: '',
      last_edited_time: '',
    }),
    getPageTitle: jest.fn().mockResolvedValue('Study Notes'),
    getTopLevelTags: jest.fn().mockResolvedValue([]),
    getBlocks: jest.fn().mockResolvedValue({
      object: 'list',
      results: blocks,
      next_cursor: null,
      has_more: false,
      type: 'block',
      block: {},
    }),
  } as unknown as NotionAPIWrapper;
}

function makeHandler(api: NotionAPIWrapper): BlockHandler {
  const settings = new CardOption({});
  const exporter = new CustomExporter('', new Workspace(true, 'fs').location);
  return new BlockHandler(exporter, api, settings);
}

async function convert(blocks: unknown[]) {
  const api = makeApi(blocks);
  const handler = makeHandler(api);
  return handler.findFlashcards({
    parentType: 'page',
    topLevelId: 'page-1',
    rules: new ParserRules(),
    decks: [],
    parentName: '',
  });
}

describe('BlockHandler toggle-less fallback', () => {
  it('produces cards from a toggle-less page with headings and content', async () => {
    const decks = await convert([
      block('heading_2', 'What is spaced repetition?'),
      block('paragraph', 'A method that spaces reviews over time.'),
      block('heading_2', 'What is a flashcard?'),
      block('paragraph', 'A prompt paired with an answer to recall.'),
      block('heading_2', 'What is active recall?'),
      block('paragraph', 'Retrieving a fact from memory, not rereading.'),
    ]);

    expect(decks).toHaveLength(1);
    const cards = decks[0].cards;
    expect(cards).toHaveLength(3);
    expect(cards[0].name).toContain('spaced repetition');
    expect(cards[0].back).toContain('spaces reviews');
    expect(cards[1].name).toContain('flashcard');
  });

  it('produces cards from Q:/A: shaped paragraphs with no toggles', async () => {
    const decks = await convert([
      block('paragraph', 'Q: What is the powerhouse of the cell?'),
      block('paragraph', 'A: The mitochondria.'),
      block('paragraph', 'Q: What carries genetic information?'),
      block('paragraph', 'A: The DNA molecule.'),
      block('paragraph', 'Q: What makes proteins in the cell?'),
      block('paragraph', 'A: The ribosome.'),
    ]);

    const cards = decks[0].cards;
    expect(cards).toHaveLength(3);
    expect(cards[0].name).toContain('powerhouse');
    expect(cards[0].back).toContain('mitochondria');
  });

  it('leaves the deck empty for a page with no guessable card shape', async () => {
    const decks = await convert([
      block('paragraph', 'Just some prose about my day.'),
      block('paragraph', 'Nothing here looks like a flashcard.'),
    ]);

    expect(decks).toHaveLength(1);
    expect(decks[0].cards).toHaveLength(0);
  });

  it('does not override real toggle cards with the fallback', async () => {
    const toggle = {
      object: 'block',
      id: 'toggle-1',
      parent: { type: 'page_id', page_id: 'page-1' },
      created_time: '',
      last_edited_time: '',
      created_by: { object: 'user', id: 'u' },
      last_edited_by: { object: 'user', id: 'u' },
      has_children: false,
      archived: false,
      in_trash: false,
      type: 'toggle',
      toggle: {
        rich_text: [richText('A real toggle question')],
        color: 'default',
      },
    };

    const decks = await convert([
      toggle,
      block('heading_2', 'A heading that should not become a card'),
      block('paragraph', 'Some content under it.'),
    ]);

    const cards = decks[0].cards;
    expect(cards).toHaveLength(1);
    expect(cards[0].name).toContain('A real toggle question');
  });
});
