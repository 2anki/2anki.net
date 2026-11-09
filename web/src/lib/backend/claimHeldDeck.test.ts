import { afterEach, describe, expect, it, vi } from 'vitest';

import { Backend } from './Backend';

function jsonResponse(status: number, body: unknown): Response {
  return {
    status,
    json: () => Promise.resolve(body),
  } as unknown as Response;
}

const PLAN_CLAIM = {
  downloadKey: 'full-deck.apkg',
  cardCount: 40,
  deckName: 'notes',
  kind: 'plan',
};

describe('Backend.claimHeldDeck', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('reads how many other saved decks the claim built', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(jsonResponse(200, { ...PLAN_CLAIM, alsoClaimed: 2 }))
    );

    await expect(new Backend().claimHeldDeck()).resolves.toEqual({
      status: 200,
      downloadKey: 'full-deck.apkg',
      cardCount: 40,
      deckName: 'notes',
      kind: 'plan',
      error: null,
      alsoClaimed: 2,
    });
  });

  it('reads the answerless lines the claim left out', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          jsonResponse(200, { ...PLAN_CLAIM, cardsLeftOut: 6 })
        )
    );

    await expect(new Backend().claimHeldDeck()).resolves.toMatchObject({
      cardsLeftOut: 6,
    });
  });

  it.each([0, 1.5, '6'])(
    'leaves the left-out count out for %s',
    async (cardsLeftOut) => {
      vi.stubGlobal(
        'fetch',
        vi
          .fn()
          .mockResolvedValue(jsonResponse(200, { ...PLAN_CLAIM, cardsLeftOut }))
      );

      const result = await new Backend().claimHeldDeck();

      expect(result).not.toHaveProperty('cardsLeftOut');
    }
  );

  it.each([
    ['no count', undefined],
    ['zero', 0],
    ['a fraction', 1.5],
    ['text', '2'],
  ])('leaves the count out for %s', async (_label, alsoClaimed) => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(jsonResponse(200, { ...PLAN_CLAIM, alsoClaimed }))
    );

    const result = await new Backend().claimHeldDeck();

    expect(result).not.toHaveProperty('alsoClaimed');
  });
});

describe('Backend.claimHeldDeck cut', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it.each([
    ['month', 'month'],
    ['preview', 'preview'],
    [undefined, 'preview'],
    ['toString', 'preview'],
  ])('reads a cut at %s as %s', async (cutAt, expected) => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        jsonResponse(200, {
          downloadKey: 'owner-key.apkg',
          cardCount: 10,
          deckName: 'notes',
          kind: 'signup',
          cardsHeldBack: 24,
          heldForPlan: true,
          cutAt,
        })
      )
    );

    await expect(new Backend().claimHeldDeck()).resolves.toMatchObject({
      cardsHeldBack: 24,
      cutAt: expected,
    });
  });
});
