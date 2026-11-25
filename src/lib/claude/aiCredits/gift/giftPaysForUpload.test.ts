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
    mayStart?: boolean;
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
      mayStartGrant: vi.fn(async () => overrides.mayStart ?? true),
      startGrant: vi.fn(async () => null),
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

  it('is true for an account with no grant yet while the gift has room for one', async () => {
    expect(await giftWouldPayForUpload(9, deps({ grant: null }))).toBe(true);
  });

  it.each([
    ['no grant and a full gift total', deps({ grant: null, mayStart: false })],
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

  describe('reading the running conversion by the readers clock', () => {
    afterEach(() => {
      vi.useRealTimers();
    });

    it('is false for a conversion taken just before the readers time, whatever the wall clock says', async () => {
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(new Date('2027-01-01T00:00:00.000Z'));
      takeGiftMarker(9, NOW.getTime() - 60_000);

      expect(await giftWouldPayForUpload(9, deps())).toBe(false);
    });

    it('is true once the readers clock is past the conversion marker lifetime', async () => {
      takeGiftMarker(9, NOW.getTime() - 2 * 60 * 60 * 1000);

      expect(await giftWouldPayForUpload(9, deps())).toBe(true);
    });
  });
});
