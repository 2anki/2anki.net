import { APIResponseError } from '@notionhq/client';
import { expandSyncedBlocks } from './expandSyncedBlocks';
import NotionAPIWrapper from '../NotionAPIWrapper';

function makeFailingApi(error: unknown): NotionAPIWrapper {
  return {
    getBlocks: jest.fn(async () => {
      throw error;
    }),
  } as unknown as NotionAPIWrapper;
}

const baseBlockShape = {
  object: 'block' as const,
  created_time: '2026-05-20T00:00:00.000Z',
  last_edited_time: '2026-05-20T00:00:00.000Z',
  created_by: { object: 'user' as const, id: 'user-1' },
  last_edited_by: { object: 'user' as const, id: 'user-1' },
  has_children: false,
  archived: false,
  in_trash: false,
  parent: { type: 'page_id' as const, page_id: 'page-1' },
};

function makeToggle(id: string, text: string) {
  return {
    ...baseBlockShape,
    id,
    type: 'toggle' as const,
    has_children: true,
    toggle: {
      rich_text: [
        {
          type: 'text' as const,
          text: { content: text, link: null },
          annotations: {
            bold: false,
            italic: false,
            strikethrough: false,
            underline: false,
            code: false,
            color: 'default' as const,
          },
          plain_text: text,
          href: null,
        },
      ],
      color: 'default' as const,
    },
  };
}

function makeSyncedBlock(id: string, syncedFromBlockId: string | null) {
  return {
    ...baseBlockShape,
    id,
    type: 'synced_block' as const,
    has_children: true,
    synced_block: {
      synced_from:
        syncedFromBlockId == null
          ? null
          : { type: 'block_id' as const, block_id: syncedFromBlockId },
    },
  };
}

function makeApi(responses: Record<string, unknown[]>): NotionAPIWrapper {
  const calls: string[] = [];
  const api = {
    getBlocks: jest.fn(async ({ id }: { id: string }) => {
      calls.push(id);
      return {
        type: 'block' as const,
        block: {},
        object: 'list' as const,
        next_cursor: null,
        has_more: false,
        results: responses[id] ?? [],
      };
    }),
  } as unknown as NotionAPIWrapper & { __calls: string[] };
  (api as unknown as { __calls: string[] }).__calls = calls;
  return api;
}

describe('expandSyncedBlocks', () => {
  it('logs one compact line when the source 404s as unshared', async () => {
    const reference = makeSyncedBlock('ref-x', 'source-x');
    const error = Object.create(APIResponseError.prototype) as APIResponseError;
    Object.assign(error, {
      name: 'APIResponseError',
      message: 'Could not find block',
      code: 'object_not_found',
      status: 404,
    });
    const api = makeFailingApi(error);
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});

    const result = await expandSyncedBlocks([reference], api, true);

    expect(result).toEqual([]);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith(
      '[notion] synced_block source not accessible (object_not_found/404) — dropped, id source-x'
    );
    warn.mockRestore();
  });

  it('keeps the full dump for unexpected error shapes', async () => {
    const reference = makeSyncedBlock('ref-y', 'source-y');
    const error = new Error('socket hang up');
    const api = makeFailingApi(error);
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});

    const result = await expandSyncedBlocks([reference], api, true);

    expect(result).toEqual([]);
    expect(warn).toHaveBeenCalledWith(
      '[notion] failed to resolve synced_block source',
      error
    );
    warn.mockRestore();
  });

  it('passes non-synced blocks through unchanged', async () => {
    const api = makeApi({});
    const toggle = makeToggle('t-1', 'plain toggle');

    const result = await expandSyncedBlocks([toggle], api, true);

    expect(result).toEqual([toggle]);
    expect(api.getBlocks).not.toHaveBeenCalled();
  });

  it('replaces an original synced_block (synced_from=null) with its own children', async () => {
    const original = makeSyncedBlock('orig-1', null);
    const childToggle = makeToggle(
      'child-toggle-1',
      'inside the synced source'
    );
    const api = makeApi({ 'orig-1': [childToggle] });

    const result = await expandSyncedBlocks([original], api, true);

    expect(result).toEqual([childToggle]);
    expect(api.getBlocks).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'orig-1' })
    );
  });

  it('replaces a reference synced_block by fetching children from synced_from.block_id', async () => {
    const reference = makeSyncedBlock('ref-1', 'source-block-99');
    const sourceChild = makeToggle(
      'source-toggle',
      'authored once, linked many'
    );
    const api = makeApi({ 'source-block-99': [sourceChild] });

    const result = await expandSyncedBlocks([reference], api, true);

    expect(result).toEqual([sourceChild]);
    expect(api.getBlocks).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'source-block-99' })
    );
  });

  it('expands nested synced_blocks recursively', async () => {
    const outer = makeSyncedBlock('outer', 'middle');
    const inner = makeSyncedBlock('middle', 'leaf');
    const leafToggle = makeToggle('leaf-toggle', 'leaf content');
    const api = makeApi({
      middle: [inner],
      leaf: [leafToggle],
    });

    const result = await expandSyncedBlocks([outer], api, true);

    expect(result).toEqual([leafToggle]);
  });

  it('stops on a cycle without infinite recursion', async () => {
    const a = makeSyncedBlock('a', 'b');
    const b = makeSyncedBlock('b', 'a');
    const api = makeApi({
      b: [b],
      a: [a],
    });

    const result = await expandSyncedBlocks([a], api, true);

    expect(Array.isArray(result)).toBe(true);
    expect(
      result.every((r) => (r as { type?: string }).type !== 'synced_block')
    ).toBe(true);
  });

  it('preserves order: blocks before and after a synced_block keep their position', async () => {
    const before = makeToggle('before', 'first');
    const reference = makeSyncedBlock('ref', 'src');
    const fromSrc = makeToggle('from-src', 'middle');
    const after = makeToggle('after', 'last');
    const api = makeApi({ src: [fromSrc] });

    const result = await expandSyncedBlocks(
      [before, reference, after],
      api,
      true
    );

    expect(result.map((b) => (b as { id: string }).id)).toEqual([
      'before',
      'from-src',
      'after',
    ]);
  });

  it('returns empty when the synced source fetch throws', async () => {
    const reference = makeSyncedBlock('ref', 'missing');
    const api = {
      getBlocks: jest.fn(async () => {
        throw new Error('not found');
      }),
    } as unknown as NotionAPIWrapper;
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});

    const result = await expandSyncedBlocks([reference], api, true);

    expect(result).toEqual([]);
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });
});
