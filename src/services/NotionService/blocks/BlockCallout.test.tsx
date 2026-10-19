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
import getListItems from '../helpers/getListItems';
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

function textOf(content: string) {
  return [
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
  ];
}

const blockBase = {
  object: 'block',
  parent: { type: 'page_id', page_id: 'page-1' },
  created_time: '2026-06-22T07:46:00.000Z',
  last_edited_time: '2026-06-22T07:46:00.000Z',
  created_by: { object: 'user', id: 'user-1' },
  last_edited_by: { object: 'user', id: 'user-1' },
  archived: false,
  in_trash: false,
};

function makeCallout(
  id: string,
  ownText: string,
  hasChildren: boolean
): CalloutBlockObjectResponse {
  return {
    ...blockBase,
    id,
    type: 'callout',
    callout: {
      rich_text: textOf(ownText),
      icon: { type: 'emoji', emoji: '💡' },
      color: 'default',
    },
    has_children: hasChildren,
  } as unknown as CalloutBlockObjectResponse;
}

function makeParagraph(id: string, content: string): BlockObjectResponse {
  return {
    ...blockBase,
    id,
    type: 'paragraph',
    paragraph: { rich_text: textOf(content), color: 'default' },
    has_children: false,
  } as unknown as BlockObjectResponse;
}

function makeDivider(id: string): BlockObjectResponse {
  return {
    ...blockBase,
    id,
    type: 'divider',
    divider: {},
    has_children: false,
  } as unknown as BlockObjectResponse;
}

function makeImage(id: string): BlockObjectResponse {
  return {
    ...blockBase,
    id,
    type: 'image',
    image: {
      type: 'external',
      external: { url: 'https://example.com/figure.png' },
      caption: [],
    },
    has_children: false,
  } as unknown as BlockObjectResponse;
}

function makeBullet(id: string): BlockObjectResponse {
  return {
    ...blockBase,
    id,
    type: 'bulleted_list_item',
    bulleted_list_item: { rich_text: textOf(id), color: 'default' },
    has_children: true,
  } as unknown as BlockObjectResponse;
}

function listResponse(results: BlockObjectResponse[]) {
  return {
    object: 'list',
    results,
    next_cursor: null,
    has_more: false,
    type: 'block',
    block: {},
  } as never;
}

function stubChildren(
  handler: BlockHandler,
  childrenById: Record<string, BlockObjectResponse[]>,
  delayById: Record<string, number> = {}
) {
  vi.spyOn(handler.api, 'getBlocks').mockImplementation(
    async ({ id }: { id: string }) => {
      const delay = delayById[id] ?? 0;
      if (delay > 0) {
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
      return listResponse(childrenById[id] ?? []);
    }
  );
}

describe('BlockCallout plain-text back', () => {
  it('keeps the callout children in the plain-text back', async () => {
    const handler = makeHandler({ paragraph: 'true' });
    const callout = makeCallout('callout-1', 'Remember', true);
    stubChildren(handler, { 'callout-1': [makeParagraph('p1', 'Key fact')] });

    const back = await BlockCallout(callout, handler);

    expect(back).toBe('Remember<br>Key fact');
  });

  it('keeps each callout child as its own line, not glued together', async () => {
    const handler = makeHandler({ paragraph: 'true' });
    const callout = makeCallout('callout-1', 'Remember', true);
    stubChildren(handler, {
      'callout-1': [
        makeParagraph('p1', 'First point'),
        makeParagraph('p2', 'Second point'),
      ],
    });

    const back = await BlockCallout(callout, handler);

    expect(back).toBe('Remember<br>First point<br>Second point');
  });

  it('returns the callout text alone when it has no children', async () => {
    const handler = makeHandler({ paragraph: 'true' });
    const callout = makeCallout('callout-1', 'Remember', false);
    stubChildren(handler, {});

    const back = await BlockCallout(callout, handler);

    expect(back).toBe('Remember');
  });

  it('keeps text that looks like HTML escaped in the plain-text back', async () => {
    const handler = makeHandler({ paragraph: 'true' });
    const callout = makeCallout('callout-1', 'Keep <b>this</b>', false);
    stubChildren(handler, {});

    const back = await BlockCallout(callout, handler);

    expect(back).toBe('Keep &lt;b&gt;this&lt;/b&gt;');
    expect(back).not.toContain('<b>');
  });

  it('strips markup from a child type without a plain-text branch', async () => {
    const handler = makeHandler({ paragraph: 'true' });
    const callout = makeCallout('callout-1', 'Remember', true);
    stubChildren(handler, {
      'callout-1': [
        makeParagraph('p1', 'Alpha'),
        makeDivider('divider-1'),
        makeParagraph('p2', 'Beta'),
      ],
    });

    const back = await BlockCallout(callout, handler);

    expect(back).toBe('Remember<br>Alpha<br>Beta');
    expect(back.replace(/<br>/g, '')).not.toContain('<');
  });

  it('does not append "null" when the children fetch fails', async () => {
    const handler = makeHandler({ paragraph: 'true' });
    const callout = makeCallout('callout-1', 'Remember', true);
    vi.spyOn(handler.api, 'getBlocks').mockRejectedValue(
      new Error('Notion is unreachable')
    );

    const back = await BlockCallout(callout, handler);

    expect(back).toBe('Remember');
    expect(back).not.toContain('null');
  });

  it('never embeds media for callout children in plain-text mode', async () => {
    const handler = makeHandler({ paragraph: 'true' });
    const callout = makeCallout('callout-1', 'Remember', true);
    stubChildren(handler, { 'callout-1': [makeImage('image-1')] });
    const embedImage = vi.spyOn(handler, 'embedImage');

    const back = await BlockCallout(callout, handler);

    expect(embedImage).not.toHaveBeenCalled();
    expect(back).toBe('Remember');
  });

  it('leaves the shared handler settings and embed methods unchanged', async () => {
    const handler = makeHandler({ paragraph: 'true' });
    const callout = makeCallout('callout-1', 'Remember', true);
    stubChildren(handler, { 'callout-1': [makeParagraph('p1', 'Key fact')] });
    const settings = handler.settings;
    const embedImage = handler.embedImage;
    const embedAudioFile = handler.embedAudioFile;
    const embedFile = handler.embedFile;

    await BlockCallout(callout, handler);

    expect(handler.settings).toBe(settings);
    expect(handler.settings.isTextOnlyBack).toBe(true);
    expect(handler.embedImage).toBe(embedImage);
    expect(handler.embedAudioFile).toBe(embedAudioFile);
    expect(handler.embedFile).toBe(embedFile);
  });

  it('keeps the handler intact when two list items render callouts out of order', async () => {
    const handler = makeHandler({ paragraph: 'true' });
    const bulletA = makeBullet('bullet-a');
    const bulletB = makeBullet('bullet-b');
    stubChildren(
      handler,
      {
        'bullet-a': [makeCallout('callout-a', 'A note', true)],
        'bullet-b': [makeCallout('callout-b', 'B note', true)],
        'callout-a': [makeParagraph('pa', 'Answer A')],
        'callout-b': [makeParagraph('pb', 'Answer B')],
      },
      { 'callout-a': 20 }
    );

    const items = await getListItems(
      listResponse([bulletA, bulletB]),
      handler,
      'bulleted_list_item',
      bulletA
    );
    const html = items
      .filter(Boolean)
      .map((node) => String((node as { props: { id: string } }).props.id))
      .join(',');

    expect(handler.settings.isTextOnlyBack).toBe(true);
    expect(html).toContain('bullet-a');
    expect(html).toContain('bullet-b');
  });

  it('renders the full figure with children when the option is off', async () => {
    const handler = makeHandler({});
    const callout = makeCallout('callout-1', 'Remember', true);
    stubChildren(handler, { 'callout-1': [makeParagraph('p1', 'Key fact')] });

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
