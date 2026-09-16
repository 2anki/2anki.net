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
      windowEnd: '2026-06-01T00:00:00.000Z',
      resets: 'period',
    });

    const result = await getAiCredits();

    expect(get).toHaveBeenCalledWith('/api/ai/credits');
    expect(result).toEqual({
      credits: 212,
      used: 88,
      allowance: 300,
      windowEnd: '2026-06-01T00:00:00.000Z',
      resets: 'period',
    });
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
