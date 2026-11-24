import { vi } from 'vitest';
import { restartAiGiftMode, uploadAiGiftMode } from './uploadGiftMode';
import type { AiGiftGrant } from './giftBalance';

const NOW = new Date('2026-11-25T12:00:00.000Z');

const grant: AiGiftGrant = {
  id: 3,
  userId: 9,
  credits: 100,
  claimedAt: new Date('2026-11-25T10:00:00.000Z'),
  expiresAt: new Date('2026-11-27T10:00:00.000Z'),
};

function readers(overrides: {
  enabled?: boolean;
  grant?: AiGiftGrant | null;
  spendUsd?: number;
  fails?: boolean;
}) {
  return {
    isEnabled: vi.fn(async () => overrides.enabled ?? true),
    findGrant: vi.fn(async () => {
      if (overrides.fails) throw new Error('db down');
      return overrides.grant === undefined ? grant : overrides.grant;
    }),
    giftCostSince: vi.fn(async () => overrides.spendUsd ?? 0),
    now: () => NOW,
  };
}

describe('uploadAiGiftMode', () => {
  it('lets a paying upload fall back on the gift without reading it', async () => {
    const deps = readers({});

    expect(await uploadAiGiftMode(9, true, () => deps)).toBe('fallback');
    expect(deps.findGrant).not.toHaveBeenCalled();
  });

  it('gives a signed-out upload nothing', async () => {
    expect(await uploadAiGiftMode(null, false, () => readers({}))).toBeNull();
  });

  it('lets a free account with unspent gift credits reach Claude on the gift only', async () => {
    expect(await uploadAiGiftMode(9, false, () => readers({}))).toBe('only');
  });

  it('marks a free account whose gift is spent, so it gets the credits notice', async () => {
    expect(
      await uploadAiGiftMode(9, false, () => readers({ spendUsd: 1 }))
    ).toBe('spent');
  });

  it('leaves a free account alone while the switch is off', async () => {
    const deps = readers({ enabled: false });

    expect(await uploadAiGiftMode(9, false, () => deps)).toBeNull();
    expect(deps.findGrant).not.toHaveBeenCalled();
  });

  it('leaves a free account without a gift on the standard free path', async () => {
    expect(
      await uploadAiGiftMode(9, false, () => readers({ grant: null }))
    ).toBeNull();
  });

  it('treats a failed read as no gift', async () => {
    expect(
      await uploadAiGiftMode(9, false, () => readers({ fails: true }))
    ).toBeNull();
  });

  it('treats an expired gift as no gift', async () => {
    const expired = readers({});
    expired.now = () => new Date('2026-11-28T00:00:00.000Z');

    expect(await uploadAiGiftMode(9, false, () => expired)).toBeNull();
  });
});

describe('restartAiGiftMode', () => {
  it('restarts a free account that claimed the gift on the gift alone', async () => {
    expect(await restartAiGiftMode(9, false, () => readers({}))).toBe('only');
  });

  it('restarts a free account that never claimed exactly as before', async () => {
    expect(
      await restartAiGiftMode(9, false, () => readers({ grant: null }))
    ).toBeNull();
  });

  it('fails closed when the read fails', async () => {
    expect(
      await restartAiGiftMode(9, false, () => readers({ fails: true }))
    ).toBe('only');
  });

  it('lets a paying restart fall back on the gift', async () => {
    expect(await restartAiGiftMode(9, true, () => readers({}))).toBe(
      'fallback'
    );
  });
});
