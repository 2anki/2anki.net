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
