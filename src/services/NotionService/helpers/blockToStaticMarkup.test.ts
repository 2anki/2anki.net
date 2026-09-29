import { BlockObjectResponse } from '@notionhq/client/build/src/api-endpoints';
import CustomExporter from '../../../lib/parser/exporters/CustomExporter';
import CardOption from '../../../lib/parser/Settings/CardOption';
import Workspace from '../../../lib/parser/WorkSpace';
import { setupTests } from '../../../test/configure-jest';
import MockNotionAPI from '../_mock/MockNotionAPI';
import BlockHandler from '../BlockHandler/BlockHandler';
import { blockToStaticMarkup } from './blockToStaticMarkup';

beforeEach(() => setupTests());

function makeHandler(): BlockHandler {
  const exporter = new CustomExporter('', new Workspace(true, 'fs').location);
  return new BlockHandler(
    exporter,
    new MockNotionAPI('', ''),
    new CardOption({})
  );
}

describe('blockToStaticMarkup', () => {
  it('drops a stray table_row block instead of leaking unsupported JSON to the card', async () => {
    const handler = makeHandler();
    const tableRow = {
      object: 'block',
      id: '3677ab29-a11e-80d8-89f3-fb77c3ef0ed7',
      type: 'table_row',
      table_row: {
        cells: [
          [
            {
              type: 'text',
              text: { content: 'first', link: null },
              annotations: {
                bold: false,
                italic: false,
                strikethrough: false,
                underline: false,
                code: false,
                color: 'default',
              },
              plain_text: 'first',
              href: null,
            },
          ],
        ],
      },
      parent: { type: 'block_id', block_id: 'parent-table-id' },
      created_time: '2026-05-21T07:46:00.000Z',
      last_edited_time: '2026-05-21T07:46:00.000Z',
      created_by: { object: 'user', id: 'user-1' },
      last_edited_by: { object: 'user', id: 'user-1' },
      has_children: false,
      archived: false,
      in_trash: false,
    } as unknown as BlockObjectResponse;

    const result = await blockToStaticMarkup(handler, tableRow);

    expect(result).toBe('');
    expect(result).not.toContain('unsupported');
    expect(result).not.toContain('table_row');
    expect(result).not.toContain('"object"');
  });

  it('renders a labelled placeholder for an empty synced_block instead of leaking unsupported JSON or nothing', async () => {
    const handler = makeHandler();
    const syncedBlock = {
      object: 'block',
      id: 'synced-1',
      type: 'synced_block',
      synced_block: { synced_from: null },
      parent: { type: 'page_id', page_id: 'page-1' },
      created_time: '2026-05-20T07:46:00.000Z',
      last_edited_time: '2026-05-20T07:46:00.000Z',
      created_by: { object: 'user', id: 'user-1' },
      last_edited_by: { object: 'user', id: 'user-1' },
      has_children: false,
      archived: false,
      in_trash: false,
    } as unknown as BlockObjectResponse;

    const result = await blockToStaticMarkup(handler, syncedBlock);

    expect(result).toContain('synced-block-empty');
    expect(result).toContain('Synced block');
    expect(result).not.toContain('unsupported');
    expect(result).not.toContain('"object"');
  });

  it('renders a pdf block as a clickable link by default', async () => {
    const handler = makeHandler();
    const pdf = {
      object: 'block',
      id: 'pdf-1',
      type: 'pdf',
      pdf: {
        type: 'external',
        external: { url: 'https://example.com/notes.pdf' },
        caption: [],
      },
      parent: { type: 'page_id', page_id: 'page-1' },
      created_time: '2026-05-21T07:46:00.000Z',
      last_edited_time: '2026-05-21T07:46:00.000Z',
      created_by: { object: 'user', id: 'user-1' },
      last_edited_by: { object: 'user', id: 'user-1' },
      has_children: false,
      archived: false,
      in_trash: false,
    } as unknown as BlockObjectResponse;

    const result = await blockToStaticMarkup(handler, pdf);

    expect(result).toContain('<a href="https://example.com/notes.pdf"');
    expect(result).not.toContain('<embed');
    expect(result).not.toContain('unsupported: pdf');
  });

  it('renders a link_preview block as a clickable link to the previewed url', async () => {
    const handler = makeHandler();
    const linkPreview = {
      object: 'block',
      id: 'link-preview-1',
      type: 'link_preview',
      link_preview: { url: 'https://github.com/2anki/server' },
      parent: { type: 'page_id', page_id: 'page-1' },
      created_time: '2026-05-21T07:46:00.000Z',
      last_edited_time: '2026-05-21T07:46:00.000Z',
      created_by: { object: 'user', id: 'user-1' },
      last_edited_by: { object: 'user', id: 'user-1' },
      has_children: false,
      archived: false,
      in_trash: false,
    } as unknown as BlockObjectResponse;

    const result = await blockToStaticMarkup(handler, linkPreview);

    expect(result).toContain('href="https://github.com/2anki/server"');
    expect(result).toContain('rel="noopener noreferrer"');
    expect(result).toContain('https://github.com/2anki/server');
    expect(result).not.toContain('unsupported: link_preview');
  });

  it('renders a standalone equation block as display math', async () => {
    const handler = makeHandler();
    const equation = {
      object: 'block',
      id: 'equation-1',
      type: 'equation',
      equation: { expression: '\\sqrt{x}' },
      parent: { type: 'page_id', page_id: 'page-1' },
      created_time: '2026-05-21T07:46:00.000Z',
      last_edited_time: '2026-05-21T07:46:00.000Z',
      created_by: { object: 'user', id: 'user-1' },
      last_edited_by: { object: 'user', id: 'user-1' },
      has_children: false,
      archived: false,
      in_trash: false,
    } as unknown as BlockObjectResponse;

    const result = await blockToStaticMarkup(handler, equation);

    expect(result).toBe('\\[\\sqrt{x}\\]');
  });

  function makePdfBlock(pdf: Record<string, unknown>): BlockObjectResponse {
    return {
      object: 'block',
      id: 'pdf-1',
      type: 'pdf',
      pdf,
      parent: { type: 'page_id', page_id: 'page-1' },
      created_time: '2026-06-03T07:46:00.000Z',
      last_edited_time: '2026-06-03T07:46:00.000Z',
      created_by: { object: 'user', id: 'user-1' },
      last_edited_by: { object: 'user', id: 'user-1' },
      has_children: false,
      archived: false,
      in_trash: false,
    } as unknown as BlockObjectResponse;
  }

  it('renders a file-hosted pdf as a link when downloadPdfs is off', async () => {
    const handler = makeHandler();
    handler.settings = new CardOption({ 'download-pdfs': 'false' });
    const embedSpy = jest.spyOn(handler, 'embedFile');
    const pdf = makePdfBlock({
      type: 'file',
      file: { url: 'https://notion.example/doc.pdf', expiry_time: '' },
    });

    const result = await blockToStaticMarkup(handler, pdf);

    expect(embedSpy).not.toHaveBeenCalled();
    expect(result).toContain('<a href="https://notion.example/doc.pdf"');
    expect(result).not.toContain('<embed');
  });

  it('downloads a file-hosted pdf as media when downloadPdfs is on', async () => {
    const handler = makeHandler();
    handler.settings = new CardOption({ 'download-pdfs': 'true' });
    const embedSpy = jest
      .spyOn(handler, 'embedFile')
      .mockResolvedValue('<embed src="2anki-doc.pdf" />');
    const pdf = makePdfBlock({
      type: 'file',
      file: { url: 'https://notion.example/doc.pdf', expiry_time: '' },
    });

    const result = await blockToStaticMarkup(handler, pdf);

    expect(embedSpy).toHaveBeenCalledWith(pdf);
    expect(result).toBe('<embed src="2anki-doc.pdf" />');
  });

  it('renders an external pdf as a link when downloadPdfs is off', async () => {
    const handler = makeHandler();
    handler.settings = new CardOption({ 'download-pdfs': 'false' });
    const embedSpy = jest.spyOn(handler, 'embedFile');
    const pdf = makePdfBlock({
      type: 'external',
      external: { url: 'https://example.com/public.pdf' },
    });

    const result = await blockToStaticMarkup(handler, pdf);

    expect(embedSpy).not.toHaveBeenCalled();
    expect(result).toContain('<a href="https://example.com/public.pdf"');
    expect(result).not.toContain('<embed');
  });

  it('renders an external pdf as a link even when downloadPdfs is on', async () => {
    const handler = makeHandler();
    handler.settings = new CardOption({ 'download-pdfs': 'true' });
    const embedSpy = jest.spyOn(handler, 'embedFile');
    const pdf = makePdfBlock({
      type: 'external',
      external: { url: 'https://example.com/public.pdf' },
    });

    const result = await blockToStaticMarkup(handler, pdf);

    expect(embedSpy).not.toHaveBeenCalled();
    expect(result).toContain('<a href="https://example.com/public.pdf"');
    expect(result).not.toContain('<embed');
  });

  it('renders a synced_block by resolving its children through getBackSide', async () => {
    const handler = makeHandler();
    const getBackSideSpy = jest
      .spyOn(handler, 'getBackSide')
      .mockResolvedValue('<p>synced child content</p>');
    const syncedBlock = {
      object: 'block',
      id: 'synced-2',
      type: 'synced_block',
      synced_block: { synced_from: null },
      parent: { type: 'page_id', page_id: 'page-1' },
      created_time: '2026-05-20T07:46:00.000Z',
      last_edited_time: '2026-05-20T07:46:00.000Z',
      created_by: { object: 'user', id: 'user-1' },
      last_edited_by: { object: 'user', id: 'user-1' },
      has_children: true,
      archived: false,
      in_trash: false,
    } as unknown as BlockObjectResponse;

    const result = await blockToStaticMarkup(handler, syncedBlock);

    expect(getBackSideSpy).toHaveBeenCalledWith(syncedBlock, true);
    expect(result).toBe('<p>synced child content</p>');
  });

  it('drops genuinely unknown block types without leaking placeholder text or JSON', async () => {
    const handler = makeHandler();
    const unknownBlock = {
      object: 'block',
      id: 'unknown-1',
      type: 'something_notion_added_later',
      parent: { type: 'page_id', page_id: 'page-1' },
      created_time: '2026-05-21T07:46:00.000Z',
      last_edited_time: '2026-05-21T07:46:00.000Z',
      created_by: { object: 'user', id: 'user-1' },
      last_edited_by: { object: 'user', id: 'user-1' },
      has_children: false,
      archived: false,
      in_trash: false,
    } as unknown as BlockObjectResponse;

    const consoleDebugSpy = jest
      .spyOn(console, 'debug')
      .mockImplementation(() => undefined);
    const result = await blockToStaticMarkup(handler, unknownBlock);

    expect(result).toBe('');
    expect(consoleDebugSpy).toHaveBeenCalledWith(
      'unsupported something_notion_added_later'
    );
    expect(handler.unsupportedBlockTypes).toEqual([
      'something_notion_added_later',
    ]);
    consoleDebugSpy.mockRestore();
  });

  function makeHeading4Block(isToggleable: boolean): BlockObjectResponse {
    return {
      object: 'block',
      id: 'heading4-1',
      type: 'heading_4',
      heading_4: {
        rich_text: [
          {
            type: 'text',
            text: { content: 'Pharmacokinetics', link: null },
            annotations: {
              bold: false,
              italic: false,
              strikethrough: false,
              underline: false,
              code: false,
              color: 'default',
            },
            plain_text: 'Pharmacokinetics',
            href: null,
          },
        ],
        color: 'default',
        is_toggleable: isToggleable,
      },
      parent: { type: 'page_id', page_id: 'page-1' },
      created_time: '2026-06-05T07:46:00.000Z',
      last_edited_time: '2026-06-05T07:46:00.000Z',
      created_by: { object: 'user', id: 'user-1' },
      last_edited_by: { object: 'user', id: 'user-1' },
      has_children: false,
      archived: false,
      in_trash: false,
    } as unknown as BlockObjectResponse;
  }

  it('renders a heading_4 block as h3-level heading markup', async () => {
    const handler = makeHandler();

    const result = await blockToStaticMarkup(handler, makeHeading4Block(false));

    expect(result).toContain('<h3');
    expect(result).toContain('Pharmacokinetics');
    expect(result).not.toContain('unsupported');
    expect(result).not.toContain('"object"');
  });

  it('renders a toggleable heading_4 block as heading markup like heading_3', async () => {
    const handler = makeHandler();

    const result = await blockToStaticMarkup(handler, makeHeading4Block(true));

    expect(result).toContain('<h3');
    expect(result).toContain('Pharmacokinetics');
    expect(result).not.toContain('unsupported');
  });

  function makeCalloutWithChildren(): BlockObjectResponse {
    return {
      object: 'block',
      id: 'callout-1',
      type: 'callout',
      callout: {
        rich_text: [
          {
            type: 'text',
            text: { content: 'Remember', link: null },
            annotations: {
              bold: false,
              italic: false,
              strikethrough: false,
              underline: false,
              code: false,
              color: 'default',
            },
            plain_text: 'Remember',
            href: null,
          },
        ],
        icon: { type: 'emoji', emoji: '💡' },
        color: 'default',
      },
      parent: { type: 'page_id', page_id: 'page-1' },
      created_time: '2026-06-22T07:46:00.000Z',
      last_edited_time: '2026-06-22T07:46:00.000Z',
      created_by: { object: 'user', id: 'user-1' },
      last_edited_by: { object: 'user', id: 'user-1' },
      has_children: true,
      archived: false,
      in_trash: false,
    } as unknown as BlockObjectResponse;
  }

  function makeBulletListItem(content: string): BlockObjectResponse {
    return {
      object: 'block',
      id: `list-${content}`,
      type: 'bulleted_list_item',
      bulleted_list_item: {
        rich_text: [
          {
            type: 'text',
            text: { content, link: null },
            annotations: {
              bold: false,
              italic: false,
              strikethrough: false,
              underline: false,
              code: false,
              color: 'default',
            },
            plain_text: content,
            href: null,
          },
        ],
        color: 'default',
      },
      parent: { type: 'block_id', block_id: 'callout-1' },
      created_time: '2026-06-22T07:46:00.000Z',
      last_edited_time: '2026-06-22T07:46:00.000Z',
      created_by: { object: 'user', id: 'user-1' },
      last_edited_by: { object: 'user', id: 'user-1' },
      has_children: false,
      archived: false,
      in_trash: false,
    } as unknown as BlockObjectResponse;
  }

  it('keeps a callout-nested list inside figure.callout instead of leaking it after the box', async () => {
    const handler = makeHandler();
    const callout = makeCalloutWithChildren();
    const listItem = makeBulletListItem('child');

    jest
      .spyOn(handler.api, 'getBlocks')
      .mockImplementation(async ({ id }: { id: string }) => {
        if (id === 'callout-1') {
          return {
            object: 'list',
            results: [listItem],
            next_cursor: null,
            has_more: false,
            type: 'block',
            block: {},
          } as never;
        }
        return {
          object: 'list',
          results: [],
          next_cursor: null,
          has_more: false,
          type: 'block',
          block: {},
        } as never;
      });

    const result = await blockToStaticMarkup(handler, callout);

    expect(result).toContain('class="callout');
    expect(result).toContain('child');

    const figureClose = result.indexOf('</figure>');
    const listOpen = result.indexOf('<ul');
    expect(figureClose).toBeGreaterThan(-1);
    expect(listOpen).toBeGreaterThan(-1);
    expect(listOpen).toBeLessThan(figureClose);

    const afterFigure = result.slice(figureClose + '</figure>'.length);
    expect(afterFigure).not.toContain('<ul');
    expect(afterFigure).not.toContain('child');
  });
});

describe('blockToStaticMarkup column blocks', () => {
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
      created_time: '2026-09-29T07:46:00.000Z',
      last_edited_time: '2026-09-29T07:46:00.000Z',
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

  // Stubbing the Notion API is the external edge; stubbing getBackSide would
  // remove renderBack from the graph, and renderBack is what decides whether a
  // column's children get walked a second time.
  function handlerWithColumns() {
    const handler = makeHandler();
    const columnList = block('column-list', 'column_list', {}, true);
    const children: Record<string, BlockObjectResponse[]> = {
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
    return { handler, columnList };
  }

  it('renders each column exactly once', async () => {
    const { handler, columnList } = handlerWithColumns();

    const back = (await handler.getBackSide(columnList)) ?? '';

    expect(back.match(/LEFTSIDE/g) ?? []).toHaveLength(1);
    expect(back.match(/RIGHTSIDE/g) ?? []).toHaveLength(1);
  });

  it('does not report a column as a block it could not convert', async () => {
    const { handler, columnList } = handlerWithColumns();

    await handler.getBackSide(columnList);

    expect(handler.unsupportedBlockTypes).not.toContain('column');
  });
});
