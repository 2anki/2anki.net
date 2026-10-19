import { vi } from 'vitest';
import {
  BlockObjectResponse,
  CalloutBlockObjectResponse,
} from '@notionhq/client/build/src/api-endpoints';
import CustomExporter from '../../../lib/parser/exporters/CustomExporter';
import CardOption from '../../../lib/parser/Settings/CardOption';
import Workspace from '../../../lib/parser/WorkSpace';
import { setupTests } from '../../../test/configure-jest';
import MockNotionAPI from '../_mock/MockNotionAPI';
import BlockHandler from '../BlockHandler/BlockHandler';
import { BlockCallout } from './BlockCallout';

beforeEach(() => setupTests());

function makeHandler(options: Record<string, string>): BlockHandler {
  const exporter = new CustomExporter('', new Workspace(true, 'fs').location);
  return new BlockHandler(
    exporter,
    new MockNotionAPI('', ''),
    new CardOption(options)
  );
}

function makeCalloutWithChildren(): CalloutBlockObjectResponse {
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
  } as unknown as CalloutBlockObjectResponse;
}

function makeParagraphChild(content: string): BlockObjectResponse {
  return {
    object: 'block',
    id: `para-${content}`,
    type: 'paragraph',
    paragraph: {
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

function stubChildren(
  handler: BlockHandler,
  childrenById: Record<string, BlockObjectResponse[]>
) {
  vi.spyOn(handler.api, 'getBlocks').mockImplementation(
    async ({ id }: { id: string }) =>
      ({
        object: 'list',
        results: childrenById[id] ?? [],
        next_cursor: null,
        has_more: false,
        type: 'block',
        block: {},
      }) as never
  );
}

describe('BlockCallout plain-text back', () => {
  it('keeps the callout children in the plain-text back', async () => {
    const handler = makeHandler({ paragraph: 'true' });
    const callout = makeCalloutWithChildren();
    stubChildren(handler, { 'callout-1': [makeParagraphChild('Key fact')] });

    const back = await BlockCallout(callout, handler);

    expect(back).toBe('Remember<br>Key fact');
  });

  it('keeps every callout child line in the plain-text back', async () => {
    const handler = makeHandler({ paragraph: 'true' });
    const callout = makeCalloutWithChildren();
    stubChildren(handler, {
      'callout-1': [
        makeParagraphChild('First point'),
        makeParagraphChild('Second point'),
      ],
    });

    const back = await BlockCallout(callout, handler);

    expect(back).toContain('First point');
    expect(back).toContain('Second point');
    expect(back).not.toContain('<figure');
  });

  it('returns the callout text alone when it has no children', async () => {
    const handler = makeHandler({ paragraph: 'true' });
    const callout = makeCalloutWithChildren();
    callout.has_children = false;
    stubChildren(handler, {});

    const back = await BlockCallout(callout, handler);

    expect(back).toBe('Remember');
  });
});
