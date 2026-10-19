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

function makeCallout(
  ownText: string,
  hasChildren: boolean
): CalloutBlockObjectResponse {
  return {
    object: 'block',
    id: 'callout-1',
    type: 'callout',
    callout: {
      rich_text: [
        {
          type: 'text',
          text: { content: ownText, link: null },
          annotations: {
            bold: false,
            italic: false,
            strikethrough: false,
            underline: false,
            code: false,
            color: 'default',
          },
          plain_text: ownText,
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
    has_children: hasChildren,
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
    const callout = makeCallout('Remember', true);
    stubChildren(handler, { 'callout-1': [makeParagraphChild('Key fact')] });

    const back = await BlockCallout(callout, handler);

    expect(back).toBe('Remember<br>Key fact');
  });

  it('keeps each callout child as its own line, not glued together', async () => {
    const handler = makeHandler({ paragraph: 'true' });
    const callout = makeCallout('Remember', true);
    stubChildren(handler, {
      'callout-1': [
        makeParagraphChild('First point'),
        makeParagraphChild('Second point'),
      ],
    });

    const back = await BlockCallout(callout, handler);

    expect(back).toBe('Remember<br>First point<br>Second point');
  });

  it('returns the callout text alone when it has no children', async () => {
    const handler = makeHandler({ paragraph: 'true' });
    const callout = makeCallout('Remember', false);
    stubChildren(handler, {});

    const back = await BlockCallout(callout, handler);

    expect(back).toBe('Remember');
  });

  it('keeps text that looks like HTML escaped in the plain-text back', async () => {
    const handler = makeHandler({ paragraph: 'true' });
    const callout = makeCallout('Keep <b>this</b>', false);
    stubChildren(handler, {});

    const back = await BlockCallout(callout, handler);

    expect(back).toBe('Keep &lt;b&gt;this&lt;/b&gt;');
    expect(back).not.toContain('<b>');
  });

  it('does not append "null" when the children fetch fails', async () => {
    const handler = makeHandler({ paragraph: 'true' });
    const callout = makeCallout('Remember', true);
    vi.spyOn(handler.api, 'getBlocks').mockRejectedValue(
      new Error('Notion is unreachable')
    );

    const back = await BlockCallout(callout, handler);

    expect(back).toBe('Remember');
    expect(back).not.toContain('null');
  });

  it('renders the full figure with children when the option is off', async () => {
    const handler = makeHandler({});
    const callout = makeCallout('Remember', true);
    stubChildren(handler, { 'callout-1': [makeParagraphChild('Key fact')] });

    const back = await BlockCallout(callout, handler);

    expect(back).toContain('class="callout');
    expect(back).toContain('Key fact');
    const figureClose = back.indexOf('</figure>');
    expect(figureClose).toBeGreaterThan(-1);
    expect(back.slice(figureClose + '</figure>'.length)).not.toContain(
      'Key fact'
    );
  });
});
