import { vi } from 'vitest';
import { giftWouldPayForUpload } from './giftPaysForUpload';
import { resetGiftMarkers, takeGiftMarker } from './giftConversionMarker';
import type { AiGiftGrant } from './giftBalance';

const NOW = new Date('2026-11-25T12:00:00.000Z');

const grant: AiGiftGrant = {
  id: 3,
  userId: 9,
  credits: 100,
  claimedAt: new Date('2026-11-25T10:00:00.000Z'),
  expiresAt: new Date('2026-11-27T10:00:00.000Z'),
};

function deps(
  overrides: {
    grant?: AiGiftGrant | null;
    spendUsd?: number;
    cardsLeft?: number;
  } = {}
) {
  return {
    gift: () => ({
      isEnabled: vi.fn(async () => true),
      findGrant: vi.fn(async () =>
        overrides.grant === undefined ? grant : overrides.grant
      ),
      giftCostSince: vi.fn(async () => overrides.spendUsd ?? 0),
      now: () => NOW,
      planSpent: vi.fn(async () => false),
    }),
    remainingMonthlyCards: vi.fn(async () => overrides.cardsLeft ?? 80),
  };
}

beforeEach(() => {
  resetGiftMarkers();
});

describe('giftWouldPayForUpload', () => {
  it('is true for an unexpired gift with credits, room in the month and no gift conversion running', async () => {
    expect(await giftWouldPayForUpload(9, deps())).toBe(true);
  });

  it.each([
    ['no gift', deps({ grant: null })],
    [
      'an expired gift',
      deps({
        grant: { ...grant, expiresAt: new Date('2026-11-25T11:00:00.000Z') },
      }),
    ],
    ['a used-up gift', deps({ spendUsd: 100 })],
    ['fewer than 20 cards left this month', deps({ cardsLeft: 19 })],
  ])('is false with %s', async (_case, readers) => {
    expect(await giftWouldPayForUpload(9, readers)).toBe(false);
  });

  it('is false while another gift conversion holds the account', async () => {
    takeGiftMarker(9);
    const readers = deps();

    expect(await giftWouldPayForUpload(9, readers)).toBe(false);
    expect(readers.remainingMonthlyCards).not.toHaveBeenCalled();
  });
});
