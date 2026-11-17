import { vi } from 'vitest';
import { APIErrorCode, APIResponseError } from '@notionhq/client';

import NotionAPIWrapper from './NotionAPIWrapper';
import type { IBlocksCacheRepository } from '../../data_layer/BlocksCacheRepository';

function makeApiError(code: string, message: string): APIResponseError {
  const err = new Error(message);
  Object.setPrototypeOf(err, APIResponseError.prototype);
  Object.assign(err, { code, name: 'APIResponseError' });
  return err as unknown as APIResponseError;
}

const BLOCK = (id: string) => ({
  object: 'block',
  id,
  type: 'paragraph',
  paragraph: { rich_text: [] },
});

describe('NotionAPIWrapper.getBlocks cursor tolerance', () => {
  test('returns the blocks collected so far and skips the cache when a later cursor is invalidated', async () => {
    const cache: IBlocksCacheRepository = {
      get: vi.fn(async () => undefined),
      save: vi.fn(async () => undefined),
    };
    const wrapper = new NotionAPIWrapper('test-token', '1', cache);

    let call = 0;
    const list = vi.fn(async () => {
      call += 1;
      if (call === 1) {
        return {
          object: 'list',
          type: 'block',
          block: {},
          results: [BLOCK('a')],
          has_more: true,
          next_cursor: 'cursor-page-2',
        };
      }
      throw makeApiError(
        APIErrorCode.ValidationError,
        'The start_cursor provided is invalid: 00000000-0000-0000-0000-000000000000'
      );
    });
    (
      wrapper as unknown as {
        notion: { blocks: { children: { list: unknown } } };
      }
    ).notion = {
      blocks: { children: { list } },
    } as unknown as NotionAPIWrapper['notion' & keyof NotionAPIWrapper];

    const response = await wrapper.getBlocks({
      createdAt: '2026-07-01T00:00:00.000Z',
      lastEditedAt: '2026-07-02T00:00:00.000Z',
      id: 'page-1',
      all: true,
      type: 'page',
    });

    expect(response.results.map((b) => (b as { id: string }).id)).toEqual([
      'a',
    ]);
    expect(cache.save).not.toHaveBeenCalled();
  });
});

type ListArgs = { block_id: string; start_cursor?: string };

function listPage(ids: string[], nextCursor: string | null) {
  return {
    object: 'list',
    type: 'block',
    block: {},
    results: ids.map(BLOCK),
    has_more: nextCursor != null,
    next_cursor: nextCursor,
  };
}

const FIRST_HUNDRED = Array.from({ length: 100 }, (_, i) => `first-${i}`);
const REST = ['rest-0', 'rest-1', 'rest-2'];

function useNotionList(wrapper: NotionAPIWrapper, list: unknown) {
  (
    wrapper as unknown as {
      notion: { blocks: { children: { list: unknown } } };
    }
  ).notion = {
    blocks: { children: { list } },
  } as unknown as NotionAPIWrapper['notion' & keyof NotionAPIWrapper];
}

function wrapperOverLongPage(cache: IBlocksCacheRepository) {
  const wrapper = new NotionAPIWrapper('test-token', '1', cache);
  const list = vi.fn(async ({ start_cursor }: ListArgs) =>
    start_cursor === 'cursor-page-2'
      ? listPage(REST, null)
      : listPage(FIRST_HUNDRED, 'cursor-page-2')
  );
  useNotionList(wrapper, list);
  return { wrapper, list };
}

function storingCache() {
  const rows = new Map<string, { results: unknown[]; has_more: boolean }>();
  const cache: IBlocksCacheRepository = {
    get: vi.fn(async ({ id }) => rows.get(id) as never),
    save: vi.fn(async ({ id, payload }) => {
      rows.set(id, structuredClone(payload));
    }),
  };
  return { cache, rows };
}

const LONG_PAGE = {
  createdAt: '2026-07-01T00:00:00.000Z',
  lastEditedAt: '2026-07-02T00:00:00.000Z',
  id: 'long-page',
  type: 'page' as const,
};

const idsOf = (response: { results: unknown[] }) =>
  response.results.map((block) => (block as { id: string }).id);

describe('NotionAPIWrapper.getBlocks cache and the free 100-block window', () => {
  test('does not cache the first 100 blocks of a longer page fetched for a free conversion', async () => {
    const { cache } = storingCache();
    const { wrapper } = wrapperOverLongPage(cache);

    const response = await wrapper.getBlocks({ ...LONG_PAGE, all: false });

    expect(response.results).toHaveLength(100);
    expect(cache.save).not.toHaveBeenCalled();
  });

  test('caches a page that fits in one fetch for a free conversion', async () => {
    const { cache, rows } = storingCache();
    const wrapper = new NotionAPIWrapper('test-token', '1', cache);
    useNotionList(
      wrapper,
      vi.fn(async () => listPage(['a'], null))
    );

    await wrapper.getBlocks({ ...LONG_PAGE, id: 'short-page', all: false });

    expect(rows.get('short-page')).toMatchObject({ has_more: false });
  });

  test('gives a paying conversion the whole page after a free conversion of the same unedited page', async () => {
    const { cache } = storingCache();
    const { wrapper } = wrapperOverLongPage(cache);

    await wrapper.getBlocks({ ...LONG_PAGE, all: false });
    const paid = await wrapper.getBlocks({ ...LONG_PAGE, all: true });

    expect(idsOf(paid)).toEqual([...FIRST_HUNDRED, ...REST]);
  });

  test('refetches a page whose cached copy is a first window saved by an earlier free conversion', async () => {
    const { cache, rows } = storingCache();
    rows.set('long-page', listPage(FIRST_HUNDRED, 'cursor-page-2'));
    const { wrapper, list } = wrapperOverLongPage(cache);

    const paid = await wrapper.getBlocks({ ...LONG_PAGE, all: true });

    expect(idsOf(paid)).toEqual([...FIRST_HUNDRED, ...REST]);
    expect(list).toHaveBeenCalledTimes(2);
    expect(rows.get('long-page')?.results).toHaveLength(103);
  });

  test('reuses the cached copy of a long page that a paying conversion fetched in full', async () => {
    const { cache } = storingCache();
    const { wrapper, list } = wrapperOverLongPage(cache);

    await wrapper.getBlocks({ ...LONG_PAGE, all: true });
    const again = await wrapper.getBlocks({ ...LONG_PAGE, all: true });

    expect(idsOf(again)).toEqual([...FIRST_HUNDRED, ...REST]);
    expect(list).toHaveBeenCalledTimes(2);
  });
});
