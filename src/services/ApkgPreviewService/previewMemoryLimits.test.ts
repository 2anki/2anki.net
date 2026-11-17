import {
  COLD_LOAD_BUDGET_BYTES,
  COLD_LOAD_MIN_WEIGHT_BYTES,
  coldLoadWeight,
} from './previewMemoryLimits';

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
