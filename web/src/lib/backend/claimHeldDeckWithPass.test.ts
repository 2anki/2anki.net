import { afterEach, describe, expect, it, vi } from 'vitest';

import { Backend } from './Backend';

describe('Backend.claimHeldDeckWithPass', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('posts the card options with the pass token and the anon cookie', async () => {
    const response = { status: 200 } as unknown as Response;
    const fetchMock = vi.fn().mockResolvedValue(response);
    vi.stubGlobal('fetch', fetchMock);

    const result = await new Backend().claimHeldDeckWithPass('cs_paid', {
      'basic-reversed': 'true',
    });

    expect(result).toBe(response);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toMatch(/upload\/claim\/pass$/);
    expect(init).toMatchObject({
      method: 'post',
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
        'X-Pass-Token': 'cs_paid',
      },
    });
    expect(JSON.parse(init.body as string)).toEqual({
      'basic-reversed': 'true',
    });
  });
});
