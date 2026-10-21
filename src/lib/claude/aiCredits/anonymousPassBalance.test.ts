import { vi } from 'vitest';
import {
  AnonymousPassBalanceReaders,
  anonymousPassRemainingCredits,
  canAnonymousPassSpend,
  computeAnonymousPassBalance,
} from './anonymousPassBalance';

const NOW = new Date('2026-09-07T12:00:00.000Z');
const DAY_MS = 24 * 60 * 60 * 1000;

function readersFor(
  pass: { kind: string; expiresAt: Date } | null,
  costUsd = 0
): AnonymousPassBalanceReaders {
  return {
    getPass: vi.fn().mockResolvedValue(pass),
    passCostSince: vi.fn().mockResolvedValue(costUsd),
  };
}

describe('computeAnonymousPassBalance', () => {
  it('values a live 7d pass at its allowance minus recorded spend', async () => {
    const readers = readersFor(
      { kind: '7d', expiresAt: new Date(NOW.getTime() + DAY_MS) },
      1.0
    );
    const balance = await computeAnonymousPassBalance(7, NOW, readers);
    expect(balance).toMatchObject({
      allowance: 500,
      spent: 100,
      credits: 400,
      resets: 'pass',
    });
  });

  it('reads spend from the pass window start', async () => {
    const expiresAt = new Date(NOW.getTime() + DAY_MS);
    const readers = readersFor({ kind: '7d', expiresAt });
    await computeAnonymousPassBalance(7, NOW, readers);
    const windowStart = new Date(expiresAt.getTime() - 7 * DAY_MS);
    expect(readers.passCostSince).toHaveBeenCalledWith(7, windowStart);
  });

  it('is at zero credits once spend reaches the allowance', async () => {
    const readers = readersFor(
      { kind: '7d', expiresAt: new Date(NOW.getTime() + DAY_MS) },
      5.0
    );
    const balance = await computeAnonymousPassBalance(7, NOW, readers);
    expect(balance?.credits).toBe(0);
  });

  it('returns null for an unknown pass', async () => {
    const balance = await computeAnonymousPassBalance(7, NOW, readersFor(null));
    expect(balance).toBeNull();
  });

  it('returns null for a non-metered pass kind', async () => {
    const readers = readersFor({
      kind: 'unlimited',
      expiresAt: new Date(NOW.getTime() + DAY_MS),
    });
    const balance = await computeAnonymousPassBalance(7, NOW, readers);
    expect(balance).toBeNull();
  });

  it('returns null for an expired pass', async () => {
    const readers = readersFor({
      kind: '7d',
      expiresAt: new Date(NOW.getTime() - DAY_MS),
    });
    const balance = await computeAnonymousPassBalance(7, NOW, readers);
    expect(balance).toBeNull();
  });
});

describe('anonymousPassRemainingCredits / canAnonymousPassSpend', () => {
  it('reports the remaining credits and answers an affordability question', async () => {
    const readers = readersFor(
      { kind: '24h', expiresAt: new Date(NOW.getTime() + DAY_MS / 2) },
      1.0
    );
    expect(await anonymousPassRemainingCredits(7, NOW, readers)).toBe(200);
    expect(await canAnonymousPassSpend(7, 150, NOW, readers)).toBe(true);
    expect(await canAnonymousPassSpend(7, 250, NOW, readers)).toBe(false);
  });

  it('reports zero remaining for an unknown pass', async () => {
    expect(await anonymousPassRemainingCredits(7, NOW, readersFor(null))).toBe(
      0
    );
  });
});
