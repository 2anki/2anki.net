import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Backend } from './Backend';

function jsonResponse(status: number, body: unknown): Response {
  return {
    status,
    json: () => Promise.resolve(body),
  } as unknown as Response;
}

describe('Backend.getHeldDeck', () => {
  let backend: Backend;

  beforeEach(() => {
    backend = new Backend();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns the counts when the server reports a hold', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          jsonResponse(200, { cardCount: 21, cardsHeldBack: 13 })
        )
    );

    await expect(backend.getHeldDeck()).resolves.toEqual({
      cardCount: 21,
      cardsHeldBack: 13,
    });
  });

  it('returns null on 204 no content', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ status: 204 } as unknown as Response)
    );

    await expect(backend.getHeldDeck()).resolves.toBeNull();
  });

  it('returns null for a 200 whose body is not a hold', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(jsonResponse(200, { success: true }))
    );

    await expect(backend.getHeldDeck()).resolves.toBeNull();
  });
});
