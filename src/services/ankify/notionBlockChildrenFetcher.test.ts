import { vi } from 'vitest';
import { notionBlockChildrenFetcherFactory } from './notionBlockChildrenFetcher';

const mockList = vi.fn();

vi.mock('@notionhq/client', async () => ({
  ...(await vi.importActual<typeof import('@notionhq/client')>(
    '@notionhq/client'
  )),
  Client: vi.fn().mockImplementation(function () {
    return {
      blocks: { children: { list: mockList } },
    };
  }),
}));

describe('notionBlockChildrenFetcherFactory', () => {
  beforeEach(() => {
    mockList.mockReset();
  });

  it('aggregates paginated results', async () => {
    mockList
      .mockResolvedValueOnce({
        results: [{ id: 'a' }],
        next_cursor: 'cursor-1',
      })
      .mockResolvedValueOnce({ results: [{ id: 'b' }], next_cursor: null });

    const fetch = notionBlockChildrenFetcherFactory('token');
    const blocks = (await fetch('block-1')) as { id: string }[];

    expect(blocks.map((b) => b.id)).toEqual(['a', 'b']);
    expect(mockList).toHaveBeenCalledTimes(2);
    expect(mockList).toHaveBeenLastCalledWith(
      expect.objectContaining({ start_cursor: 'cursor-1' })
    );
  });

  it('retries a connect timeout instead of discarding the page walk', async () => {
    const fetchFailed = new TypeError('fetch failed') as TypeError & {
      cause?: unknown;
    };
    fetchFailed.cause = Object.assign(new Error('Connect Timeout Error'), {
      code: 'UND_ERR_CONNECT_TIMEOUT',
    });
    mockList
      .mockRejectedValueOnce(fetchFailed)
      .mockResolvedValueOnce({ results: [{ id: 'a' }], next_cursor: null });

    const fetch = notionBlockChildrenFetcherFactory('token');
    const blocks = (await fetch('block-1')) as { id: string }[];

    expect(blocks.map((b) => b.id)).toEqual(['a']);
    expect(mockList).toHaveBeenCalledTimes(2);
  });
});
