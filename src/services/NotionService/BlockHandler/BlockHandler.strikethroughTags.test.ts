import { vi } from 'vitest';
import BlockHandler from './BlockHandler';
import CardOption from '../../../lib/parser/Settings/CardOption';
import CustomExporter from '../../../lib/parser/exporters/CustomExporter';
import ParserRules from '../../../lib/parser/ParserRules';
import Workspace from '../../../lib/parser/WorkSpace';
import NotionAPIWrapper from '../NotionAPIWrapper';
import { setupTests } from '../../../test/configure-jest';

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

const locator = () => ({
  parentType: 'page' as const,
  topLevelId: 'page-1',
  rules: new ParserRules(),
  decks: [],
  parentName: '',
});

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

async function convert(settings: CardOption) {
  const handler = new BlockHandler(
    new CustomExporter('', new Workspace(true, 'fs').location),
    makeApi(page),
    settings
  );
  const decks = await handler.findFlashcards(locator());
  return decks[0].cards;
}

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
});
