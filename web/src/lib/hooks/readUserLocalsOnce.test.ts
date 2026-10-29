import { QueryClient } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../backend/getUserLocals', () => ({
  getUserLocals: vi.fn(),
}));

import { getUserLocals } from '../backend/getUserLocals';
import { readUserLocalsOnce } from './readUserLocalsOnce';

const mockGetUserLocals = vi.mocked(getUserLocals);

describe('readUserLocalsOnce', () => {
  it('asks once and fails at once when the read fails, with no retries', async () => {
    mockGetUserLocals.mockReset();
    mockGetUserLocals.mockRejectedValue(new Error('offline'));
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: 3, retryDelay: 1000 } },
    });

    await expect(readUserLocalsOnce(queryClient)).rejects.toThrow('offline');
    expect(mockGetUserLocals).toHaveBeenCalledTimes(1);
  });

  it('leaves the earlier account data in the cache for other readers when the read fails', async () => {
    const earlier = { locals: { owner: 8 }, user: { id: 8 } };
    mockGetUserLocals.mockReset();
    mockGetUserLocals.mockRejectedValue(new Error('offline'));
    const queryClient = new QueryClient();
    queryClient.setQueryData(['userLocals'], earlier);

    await expect(readUserLocalsOnce(queryClient)).rejects.toThrow('offline');
    expect(queryClient.getQueryData(['userLocals'])).toEqual(earlier);
  });

  it('leaves the earlier account data in the cache for other readers while the read has not answered', async () => {
    const earlier = { locals: { owner: 8 }, user: { id: 8 } };
    mockGetUserLocals.mockReset();
    mockGetUserLocals.mockReturnValue(new Promise<never>(() => {}));
    const queryClient = new QueryClient();
    queryClient.setQueryData(['userLocals'], earlier);

    void readUserLocalsOnce(queryClient);
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(mockGetUserLocals).toHaveBeenCalledTimes(1);
    expect(queryClient.getQueryData(['userLocals'])).toEqual(earlier);
  });

  it('joins a read of the account already in flight instead of starting another', async () => {
    const answer = { locals: { owner: 8 }, user: { id: 8 } };
    mockGetUserLocals.mockReset();
    mockGetUserLocals.mockImplementation(
      () =>
        new Promise((resolve) =>
          setTimeout(
            () =>
              resolve(
                answer as unknown as Awaited<ReturnType<typeof getUserLocals>>
              ),
            10
          )
        )
    );
    const queryClient = new QueryClient();
    const inFlight = queryClient.fetchQuery({
      queryKey: ['userLocals'],
      queryFn: getUserLocals,
    });

    await expect(readUserLocalsOnce(queryClient)).resolves.toEqual(answer);
    await inFlight;
    expect(mockGetUserLocals).toHaveBeenCalledTimes(1);
  });

  it('reads past cached data and stores the answer where the page reads it', async () => {
    const stale = { locals: { owner: 8 }, user: { id: 8 } };
    const fresh = { locals: { owner: 9 }, user: { id: 9 } };
    mockGetUserLocals.mockReset();
    mockGetUserLocals.mockResolvedValue(
      fresh as unknown as Awaited<ReturnType<typeof getUserLocals>>
    );
    const queryClient = new QueryClient();
    queryClient.setQueryData(['userLocals'], stale);

    await expect(readUserLocalsOnce(queryClient)).resolves.toEqual(fresh);
    expect(queryClient.getQueryData(['userLocals'])).toEqual(fresh);
  });
});
