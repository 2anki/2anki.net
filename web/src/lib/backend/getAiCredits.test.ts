import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./api', () => ({ get: vi.fn() }));

import { get } from './api';
import { getAiCredits } from './getAiCredits';

describe('getAiCredits', () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => vi.restoreAllMocks());

  it('returns the parsed balance, carrying period usage, when the shape is valid', async () => {
    vi.mocked(get).mockResolvedValue({
      credits: 212,
      used: 88,
      allowance: 300,
      usable: true,
      windowEnd: '2026-06-01T00:00:00.000Z',
      resets: 'period',
    });

    const result = await getAiCredits();

    expect(get).toHaveBeenCalledWith('/api/ai/credits');
    expect(result).toEqual({
      credits: 212,
      used: 88,
      allowance: 300,
      usable: true,
      windowEnd: '2026-06-01T00:00:00.000Z',
      resets: 'period',
    });
  });

  it('coerces a missing usable flag to false', async () => {
    vi.mocked(get).mockResolvedValue({
      credits: 150,
      used: 100,
      allowance: 0,
      windowEnd: '2026-11-18T00:00:00.000Z',
      resets: 'pass',
    });

    const result = await getAiCredits();

    expect(result?.usable).toBe(false);
  });

  it('returns null when the body is missing the numeric fields', async () => {
    vi.mocked(get).mockResolvedValue({ credits: 'lots', allowance: 300 });
    await expect(getAiCredits()).resolves.toBeNull();
  });

  it('returns null when the request throws', async () => {
    vi.mocked(get).mockRejectedValue(new Error('network down'));
    await expect(getAiCredits()).resolves.toBeNull();
  });
});
