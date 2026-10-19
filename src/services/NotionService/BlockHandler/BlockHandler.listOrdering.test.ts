import { vi } from 'vitest';
import {
  BlockObjectResponse,
  ListBlockChildrenResponse,
} from '@notionhq/client/build/src/api-endpoints';

import { setupTests } from '../../../test/configure-jest';
import CustomExporter from '../../../lib/parser/exporters/CustomExporter';
import Workspace from '../../../lib/parser/WorkSpace';
import CardOption from '../../../lib/parser/Settings/CardOption';
import BlockHandler from './BlockHandler';
import NotionAPIWrapper from '../NotionAPIWrapper';

beforeEach(() => setupTests());

vi.mock('../helpers/isTesting', () => ({
  __esModule: true,
  default: vi.fn(() => false),
}));

function baseBlock(id: string): Omit<BlockObjectResponse, 'type'> {
  return {
    object: 'block',
    id,
    parent: { type: 'block_id', block_id: 'parent-1' },
    created_time: '',
    last_edited_time: '',
    created_by: { object: 'user', id: 'u' },
    last_edited_by: { object: 'user', id: 'u' },
    has_children: false,
    archived: false,
    in_trash: false,
  } as unknown as Omit<BlockObjectResponse, 'type'>;
}

function richText(text: string) {
  return [
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
  ];
}

function makeHeading(id: string, text: string): BlockObjectResponse {
  return {
    ...baseBlock(id),
    type: 'heading_2',
    heading_2: {
      rich_text: richText(text),
      color: 'default',
      is_toggleable: false,
    },
  } as unknown as BlockObjectResponse;
}

function makeParagraph(id: string, text: string): BlockObjectResponse {
  return {
    ...baseBlock(id),
    type: 'paragraph',
    paragraph: { rich_text: richText(text), color: 'default' },
  } as unknown as BlockObjectResponse;
}

function makeBullet(id: string, text: string): BlockObjectResponse {
  return {
    ...baseBlock(id),
    type: 'bulleted_list_item',
    bulleted_list_item: { rich_text: richText(text), color: 'default' },
  } as unknown as BlockObjectResponse;
}

function makeNumbered(id: string, text: string): BlockObjectResponse {
  return {
    ...baseBlock(id),
    type: 'numbered_list_item',
    numbered_list_item: { rich_text: richText(text), color: 'default' },
  } as unknown as BlockObjectResponse;
}

function makeTodo(id: string, text: string): BlockObjectResponse {
  return {
    ...baseBlock(id),
    type: 'to_do',
    to_do: { rich_text: richText(text), color: 'default', checked: false },
  } as unknown as BlockObjectResponse;
}

function makeParent(): BlockObjectResponse {
  return {
    ...baseBlock('parent-1'),
    has_children: true,
    type: 'toggle',
    toggle: { rich_text: [], color: 'default' },
  } as unknown as BlockObjectResponse;
}

function makeChildrenResponse(
  children: BlockObjectResponse[]
): ListBlockChildrenResponse {
  return {
    object: 'list',
    results: children,
    next_cursor: null,
    has_more: false,
    type: 'block',
    block: {},
  } as unknown as ListBlockChildrenResponse;
}

function buildHandler(children: BlockObjectResponse[]): BlockHandler {
  const ws = new Workspace(true, 'fs');
  const exporter = new CustomExporter('', ws.location);
  const api = {
    getBlocks: vi.fn(async () => makeChildrenResponse(children)),
  } as unknown as NotionAPIWrapper;
  return new BlockHandler(exporter, api, new CardOption({}));
}

describe('getBackSide list run grouping', () => {
  beforeEach(() => vi.clearAllMocks());

  it('renders a later heading before the bullets that follow it', async () => {
    const handler = buildHandler([
      makeHeading('h-a', 'Heading A'),
      makeBullet('b-1', 'First one'),
      makeBullet('b-2', 'Second one'),
      makeHeading('h-b', 'Heading B'),
      makeBullet('b-3', 'Third one'),
      makeBullet('b-4', 'Fourth one'),
    ]);

    const back = (await handler.getBackSide(makeParent())) ?? '';

    expect(back.indexOf('Heading B')).toBeGreaterThan(-1);
    expect(back.indexOf('Third one')).toBeGreaterThan(-1);
    expect(back.indexOf('Heading B')).toBeLessThan(back.indexOf('Third one'));
  });

  it('renders paragraph, bullets, paragraph, bullets in source order', async () => {
    const handler = buildHandler([
      makeParagraph('p-1', 'Intro'),
      makeBullet('b-1', 'Alpha'),
      makeParagraph('p-2', 'Middle'),
      makeBullet('b-2', 'Beta'),
    ]);

    const back = (await handler.getBackSide(makeParent())) ?? '';

    expect(back.indexOf('Intro')).toBeLessThan(back.indexOf('Alpha'));
    expect(back.indexOf('Alpha')).toBeLessThan(back.indexOf('Middle'));
    expect(back.indexOf('Middle')).toBeLessThan(back.indexOf('Beta'));
  });

  it('renders a bulleted run then a numbered run as two separate lists', async () => {
    const handler = buildHandler([
      makeBullet('b-1', 'Bullet one'),
      makeBullet('b-2', 'Bullet two'),
      makeNumbered('n-1', 'Number one'),
      makeNumbered('n-2', 'Number two'),
    ]);

    const back = (await handler.getBackSide(makeParent())) ?? '';

    expect(back).toContain('<ul');
    expect(back).toContain('<ol');
    expect(back.indexOf('Number one')).toBeGreaterThan(back.indexOf('<ol'));
    expect(back.indexOf('Bullet one')).toBeLessThan(back.indexOf('<ol'));
  });

  it('keeps to-do items out of a preceding bullet list', async () => {
    const handler = buildHandler([
      makeBullet('b-1', 'Plain bullet'),
      makeTodo('t-1', 'Check me'),
    ]);

    const back = (await handler.getBackSide(makeParent())) ?? '';

    expect(back).toContain('to-do-list');
    expect(back).toContain('checkbox');
  });
});
