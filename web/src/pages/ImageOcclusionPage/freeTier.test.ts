import { describe, expect, it } from 'vitest';

import { FREE_TIER_LIMIT, takeFreeSlots } from './freeTier';

describe('takeFreeSlots', () => {
  it('keeps every incoming image for a paying user', () => {
    expect(takeFreeSlots(7, ['a', 'b', 'c', 'd'], true)).toEqual({
      kept: ['a', 'b', 'c', 'd'],
      dropped: 0,
    });
  });

  it('keeps only the images that fit under the free cap', () => {
    expect(takeFreeSlots(1, ['a', 'b', 'c', 'd'], false)).toEqual({
      kept: ['a', 'b'],
      dropped: 2,
    });
  });

  it('keeps nothing when the free queue is already full', () => {
    expect(takeFreeSlots(FREE_TIER_LIMIT, ['a'], false)).toEqual({
      kept: [],
      dropped: 1,
    });
  });

  it('reports no drop when the pick fits exactly', () => {
    expect(takeFreeSlots(0, ['a', 'b', 'c'], false)).toEqual({
      kept: ['a', 'b', 'c'],
      dropped: 0,
    });
  });

  it('never reports a negative drop when the queue already exceeds the cap', () => {
    expect(takeFreeSlots(5, [], false)).toEqual({ kept: [], dropped: 0 });
  });
});
