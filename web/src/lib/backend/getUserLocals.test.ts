import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clearPassToken, storePassToken } from '../anonymousPass';
import { getUserLocals } from './getUserLocals';

describe('getUserLocals', () => {
  const fetchSpy = vi.fn();

  beforeEach(() => {
    const store = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => store.set(key, value),
      removeItem: (key: string) => store.delete(key),
    });
    vi.stubGlobal('fetch', fetchSpy);
    fetchSpy.mockResolvedValue(
      new Response(JSON.stringify({ locals: {} }), { status: 200 })
    );
  });

  afterEach(() => {
    clearPassToken();
    fetchSpy.mockReset();
    vi.unstubAllGlobals();
  });

  it('sends the stored pass token so a pass bought before signing up moves to the account', async () => {
    storePassToken('cs_bought_anon');

    await getUserLocals();

    expect(fetchSpy).toHaveBeenCalledWith(
      expect.stringContaining('users/debug/locals'),
      expect.objectContaining({
        credentials: 'include',
        headers: { 'X-Pass-Claim': 'cs_bought_anon' },
      })
    );
  });

  it('sends no pass header when no pass was bought in this browser', async () => {
    await getUserLocals();

    expect(fetchSpy).toHaveBeenCalledWith(
      expect.stringContaining('users/debug/locals'),
      expect.objectContaining({ credentials: 'include', headers: undefined })
    );
  });
});
