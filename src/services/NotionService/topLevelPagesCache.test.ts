import { vi } from 'vitest';
import {
  __resetTopLevelPagesCacheForTests,
  getTopLevelPagesCache,
  invalidateTopLevelPagesForOwner,
  setTopLevelPagesCache,
  TOP_LEVEL_PAGES_CACHE_TTL_MS,
} from './topLevelPagesCache';

const VALUE = { results: [{ id: 'p1' } as never] };

describe('topLevelPagesCache', () => {
  beforeEach(() => {
    __resetTopLevelPagesCacheForTests();
  });

  it('returns undefined on miss', () => {
    expect(getTopLevelPagesCache(1, '')).toBeUndefined();
  });

  it('returns the stored value within the TTL', () => {
    setTopLevelPagesCache(1, '', VALUE);
    expect(getTopLevelPagesCache(1, '')).toEqual(VALUE);
  });

  it('expires entries after the TTL', () => {
    vi.useFakeTimers();
    try {
      setTopLevelPagesCache(1, '', VALUE);
      vi.advanceTimersByTime(TOP_LEVEL_PAGES_CACHE_TTL_MS + 1);
      expect(getTopLevelPagesCache(1, '')).toBeUndefined();
    } finally {
      vi.useRealTimers();
    }
  });

  it('normalises queries (trim + lowercase)', () => {
    setTopLevelPagesCache(1, 'My Page', VALUE);
    expect(getTopLevelPagesCache(1, '  my page  ')).toEqual(VALUE);
  });

  it('isolates by owner', () => {
    setTopLevelPagesCache(1, '', VALUE);
    expect(getTopLevelPagesCache(2, '')).toBeUndefined();
  });

  it('invalidateTopLevelPagesForOwner clears only that owner', () => {
    setTopLevelPagesCache(1, '', VALUE);
    setTopLevelPagesCache(1, 'foo', VALUE);
    setTopLevelPagesCache(2, '', VALUE);

    invalidateTopLevelPagesForOwner(1);

    expect(getTopLevelPagesCache(1, '')).toBeUndefined();
    expect(getTopLevelPagesCache(1, 'foo')).toBeUndefined();
    expect(getTopLevelPagesCache(2, '')).toEqual(VALUE);
  });
});
