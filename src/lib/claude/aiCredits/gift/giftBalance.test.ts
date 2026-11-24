import { vi } from 'vitest';
import { computeAiGiftBalance, type AiGiftGrant } from './giftBalance';
import {
  AI_GIFT_CREDITS_PER_CLAIM,
  AI_GIFT_TOTAL_BUDGET_CREDITS,
  giftBudgetHasRoom,
  giftExpiresAt,
} from './giftTerms';

const grant: AiGiftGrant = {
  id: 4,
  userId: 12,
  credits: 100,
  claimedAt: new Date('2026-11-25T10:00:00.000Z'),
  expiresAt: new Date('2026-11-27T10:00:00.000Z'),
};

function readers(spendUsd: number, enabled = true) {
  return {
    isEnabled: vi.fn(async () => enabled),
    findGrant: vi.fn(async () => grant),
    giftCostSince: vi.fn(async () => spendUsd),
  };
}

describe('computeAiGiftBalance', () => {
  it('counts spend recorded against the grant from its claim onward', async () => {
    const deps = readers(0.37);

    const balance = await computeAiGiftBalance(
      12,
      new Date('2026-11-26T00:00:00.000Z'),
      deps
    );

    expect(balance).toMatchObject({ giftId: 4, credits: 63, spent: 37 });
    expect(deps.giftCostSince).toHaveBeenCalledWith(4, 12, grant.claimedAt);
  });

  it('never goes below zero when in-flight calls took the grant past 100', async () => {
    const balance = await computeAiGiftBalance(
      12,
      new Date('2026-11-26T00:00:00.000Z'),
      readers(1.4)
    );

    expect(balance).toMatchObject({ credits: 0, spent: 140 });
  });

  it('is gone once the grant expires', async () => {
    expect(
      await computeAiGiftBalance(12, grant.expiresAt, readers(0))
    ).toBeNull();
  });

  it('is gone while the switch is off', async () => {
    const deps = readers(0, false);

    expect(
      await computeAiGiftBalance(12, new Date('2026-11-26T00:00:00.000Z'), deps)
    ).toBeNull();
    expect(deps.findGrant).not.toHaveBeenCalled();
  });
});

describe('gift terms', () => {
  it('expires a claim 48 hours later', () => {
    expect(giftExpiresAt(new Date('2026-11-25T10:00:00.000Z'))).toEqual(
      new Date('2026-11-27T10:00:00.000Z')
    );
  });

  it('never expires a claim after 2026-12-04 22:00 UTC', () => {
    expect(giftExpiresAt(new Date('2026-12-04T19:59:00.000Z'))).toEqual(
      new Date('2026-12-04T22:00:00.000Z')
    );
  });

  it('has room only while exposure plus one claim stays within the budget', () => {
    const lastFit = AI_GIFT_TOTAL_BUDGET_CREDITS - AI_GIFT_CREDITS_PER_CLAIM;
    expect(giftBudgetHasRoom(lastFit)).toBe(true);
    expect(giftBudgetHasRoom(lastFit + 1)).toBe(false);
  });
});
