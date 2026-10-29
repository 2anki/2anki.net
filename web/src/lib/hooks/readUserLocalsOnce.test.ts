import { describe, expect, it, vi } from 'vitest';

vi.mock('../backend/getUserLocals', () => ({
  getUserLocals: vi.fn(),
}));

import { getUserLocals } from '../backend/getUserLocals';
import { AccountUnreadError, readUserLocalsOnce } from './readUserLocalsOnce';

const mockGetUserLocals = vi.mocked(getUserLocals);

describe('readUserLocalsOnce', () => {
  it('asks once and fails at once when the read fails, with no retries', async () => {
    mockGetUserLocals.mockReset();
    mockGetUserLocals.mockRejectedValue(new Error('offline'));

    await expect(readUserLocalsOnce()).rejects.toThrow('offline');
    expect(mockGetUserLocals).toHaveBeenCalledTimes(1);
  });

  it('answers with the account the server reads now', async () => {
    const fresh = { locals: { owner: 9 }, user: { id: 9 } };
    mockGetUserLocals.mockReset();
    mockGetUserLocals.mockResolvedValue(
      fresh as unknown as Awaited<ReturnType<typeof getUserLocals>>
    );

    await expect(readUserLocalsOnce()).resolves.toEqual(fresh);
    expect(mockGetUserLocals).toHaveBeenCalledTimes(1);
  });

  it('fails, rather than answering signed out, when the read comes back with no account data', async () => {
    mockGetUserLocals.mockReset();
    mockGetUserLocals.mockResolvedValue(
      undefined as unknown as Awaited<ReturnType<typeof getUserLocals>>
    );

    await expect(readUserLocalsOnce()).rejects.toBeInstanceOf(
      AccountUnreadError
    );
  });
});
