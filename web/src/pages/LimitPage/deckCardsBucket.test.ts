import { describe, expect, it } from 'vitest';

import { deckCardsBucket } from './deckCardsBucket';
import { ANONYMOUS_CARD_CAP, FREE_MONTHLY_CARDS } from './LimitWall';

describe('deckCardsBucket', () => {
  it('buckets a deck inside the no-account cap', () => {
    expect(deckCardsBucket(ANONYMOUS_CARD_CAP)).toBe('within_anonymous_cap');
    expect(deckCardsBucket(1)).toBe('within_anonymous_cap');
  });

  it('buckets a deck a free month can still cover', () => {
    expect(deckCardsBucket(ANONYMOUS_CARD_CAP + 1)).toBe('within_free_month');
    expect(deckCardsBucket(FREE_MONTHLY_CARDS)).toBe('within_free_month');
  });

  it('buckets a deck past a free month on its own', () => {
    expect(deckCardsBucket(FREE_MONTHLY_CARDS + 1)).toBe('over_free_month');
    expect(deckCardsBucket(500)).toBe('over_free_month');
  });
});
