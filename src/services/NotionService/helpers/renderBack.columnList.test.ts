import { BlockObjectResponse } from '@notionhq/client/build/src/api-endpoints';
import CustomExporter from '../../../lib/parser/exporters/CustomExporter';
import CardOption from '../../../lib/parser/Settings/CardOption';
import Workspace from '../../../lib/parser/WorkSpace';
import { setupTests } from '../../../test/configure-jest';
import MockNotionAPI from '../_mock/MockNotionAPI';
import ParserRules from '../../../lib/parser/ParserRules';
import BlockHandler from '../BlockHandler/BlockHandler';

beforeEach(() => setupTests());

function block(
  id: string,
  type: string,
  body: Record<string, unknown>,
  hasChildren: boolean
): BlockObjectResponse {
  return {
    object: 'block',
    id,
    type,
    [type]: body,
    parent: { type: 'block_id', block_id: 'parent' },
    created_time: '2026-09-30T07:46:00.000Z',
    last_edited_time: '2026-09-30T07:46:00.000Z',
    created_by: { object: 'user', id: 'user-1' },
    last_edited_by: { object: 'user', id: 'user-1' },
    has_children: hasChildren,
    archived: false,
    in_trash: false,
  } as unknown as BlockObjectResponse;
}

function paragraph(id: string, text: string): BlockObjectResponse {
  return block(
    id,
    'paragraph',
    {
      rich_text: [
        {
          type: 'text',
          text: { content: text, link: null },
          annotations: {
            bold: false,
            italic: false,
            strikethrough: false,
            underline: false,
            code: false,
            color: 'default',
          },
          plain_text: text,
          href: null,
        },
      ],
      color: 'default',
    },
    false
  );
}

// Stubbing the Notion API is the external edge. Stubbing getBackSide would
// remove renderBack from the graph, and renderBack is the half of the walk
// that decides whether a container's children get rendered a second time.
function handlerWithTwoColumns() {
  const exporter = new CustomExporter('', new Workspace(true, 'fs').location);
  const handler = new BlockHandler(
    exporter,
    new MockNotionAPI('', ''),
    new CardOption({})
  );
  const children: Record<string, BlockObjectResponse[]> = {
    toggle: [block('column-list', 'column_list', {}, true)],
    'column-list': [
      block('col-0', 'column', {}, true),
      block('col-1', 'column', {}, true),
    ],
    'col-0': [paragraph('p-left', 'LEFTSIDE')],
    'col-1': [paragraph('p-right', 'RIGHTSIDE')],
  };
  jest
    .spyOn(handler.api, 'getBlocks')
    .mockImplementation(async ({ id }: { id: string }) => {
      return {
        results: children[id] ?? [],
        has_more: false,
        next_cursor: null,
      } as never;
    });
  return {
    handler,
    toggle: block('toggle', 'toggle', { rich_text: [] }, true),
  };
}

describe('renderBack with a column layout inside a toggle answer', () => {
  it('renders each column exactly once', async () => {
    const { handler, toggle } = handlerWithTwoColumns();

    const back = (await handler.getBackSide(toggle)) ?? '';

    expect(back.match(/LEFTSIDE/g) ?? []).toHaveLength(1);
    expect(back.match(/RIGHTSIDE/g) ?? []).toHaveLength(1);
  });

  it('keeps the columns in document order', async () => {
    const { handler, toggle } = handlerWithTwoColumns();

    const back = (await handler.getBackSide(toggle)) ?? '';

    expect(back.indexOf('LEFTSIDE')).toBeLessThan(back.indexOf('RIGHTSIDE'));
  });
});

describe('two-column flashcard convention', () => {
  it('keeps the first column as the front and the second as the back', async () => {
    const { handler } = handlerWithTwoColumns();
    const rules = new ParserRules();
    rules.setFlashcardTypes(['column_list']);

    const cards = await handler.getFlashcards(
      rules,
      [block('column-list', 'column_list', {}, true)],
      [],
      undefined
    );

    expect(cards).toHaveLength(1);
    expect(cards[0].name).toContain('LEFTSIDE');
    expect(cards[0].name).not.toContain('RIGHTSIDE');
    expect(cards[0].back).toContain('RIGHTSIDE');
    expect(cards[0].back).not.toContain('LEFTSIDE');
  });
});

describe('containers that walk their own children', () => {
  function handlerWithNesting(
    wrapperType: string,
    wrapperBody: Record<string, unknown>
  ) {
    const exporter = new CustomExporter('', new Workspace(true, 'fs').location);
    const handler = new BlockHandler(
      exporter,
      new MockNotionAPI('', ''),
      new CardOption({})
    );
    const children: Record<string, BlockObjectResponse[]> = {
      toggle: [block('wrapper', wrapperType, wrapperBody, true)],
      wrapper: [block('column-list', 'column_list', {}, true)],
      'column-list': [
        block('col-0', 'column', {}, true),
        block('col-1', 'column', {}, true),
      ],
      'col-0': [paragraph('p-left', 'LEFTSIDE')],
      'col-1': [paragraph('p-right', 'RIGHTSIDE')],
    };
    jest
      .spyOn(handler.api, 'getBlocks')
      .mockImplementation(async ({ id }: { id: string }) => {
        return {
          results: children[id] ?? [],
          has_more: false,
          next_cursor: null,
        } as never;
      });
    return {
      handler,
      toggle: block('toggle', 'toggle', { rich_text: [] }, true),
    };
  }

  it.each([
    ['toggle', { rich_text: [] }],
    ['callout', { rich_text: [], icon: null, color: 'default' }],
  ])(
    'renders columns once when they sit inside a nested %s',
    async (wrapperType, wrapperBody) => {
      const { handler, toggle } = handlerWithNesting(wrapperType, wrapperBody);

      const back = (await handler.getBackSide(toggle)) ?? '';

      expect(back.match(/LEFTSIDE/g) ?? []).toHaveLength(1);
      expect(back.match(/RIGHTSIDE/g) ?? []).toHaveLength(1);
    }
  );

  it.each(['numbered_list_item', 'to_do', 'bulleted_list_item'])(
    'renders a %s child exactly once',
    async (listType) => {
      const exporter = new CustomExporter(
        '',
        new Workspace(true, 'fs').location
      );
      const handler = new BlockHandler(
        exporter,
        new MockNotionAPI('', ''),
        new CardOption({})
      );
      const body =
        listType === 'to_do'
          ? { rich_text: [], checked: false, color: 'default' }
          : { rich_text: [], color: 'default' };
      const children: Record<string, BlockObjectResponse[]> = {
        toggle: [block('item', listType, body, true)],
        item: [paragraph('p-child', 'CHILDTEXT')],
      };
      jest
        .spyOn(handler.api, 'getBlocks')
        .mockImplementation(async ({ id }: { id: string }) => {
          return {
            results: children[id] ?? [],
            has_more: false,
            next_cursor: null,
          } as never;
        });

      const back =
        (await handler.getBackSide(
          block('toggle', 'toggle', { rich_text: [] }, true)
        )) ?? '';

      expect(back.match(/CHILDTEXT/g) ?? []).toHaveLength(1);
    }
  );
});
