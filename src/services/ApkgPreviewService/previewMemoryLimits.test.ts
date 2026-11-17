import {
  COLD_LOAD_BUDGET_BYTES,
  COLD_LOAD_MIN_WEIGHT_BYTES,
  coldLoadWeight,
  resetPreviewMemoryLimitsForTesting,
  sharedPreviewLimits,
} from './previewMemoryLimits';

describe('resetPreviewMemoryLimitsForTesting', () => {
  it('replaces a held cold-load limit and a filled cache budget with empty ones', async () => {
    await sharedPreviewLimits().coldLoads.acquire(COLD_LOAD_BUDGET_BYTES);
    sharedPreviewLimits().cacheBudget.admit({}, 100, () => {});

    resetPreviewMemoryLimitsForTesting();

    expect(sharedPreviewLimits().coldLoads.inUse).toBe(0);
    expect(sharedPreviewLimits().cacheBudget.totalBytes).toBe(0);
  });
});

describe('coldLoadWeight', () => {
  it('weighs a small deck at the minimum, so at most four run at once', () => {
    expect(coldLoadWeight(4096)).toBe(COLD_LOAD_MIN_WEIGHT_BYTES);
    expect(COLD_LOAD_BUDGET_BYTES / coldLoadWeight(4096)).toBe(4);
  });

  it('weighs a deck above the minimum at its stored size', () => {
    const storedBytes = COLD_LOAD_MIN_WEIGHT_BYTES + 1;

    expect(coldLoadWeight(storedBytes)).toBe(storedBytes);
  });
});
