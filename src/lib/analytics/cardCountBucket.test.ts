import { toCardCountBucket } from './cardCountBucket';

describe('toCardCountBucket', () => {
  it('separates near-empty successes from real ones', () => {
    expect(toCardCountBucket(0)).toBe('<3');
    expect(toCardCountBucket(1)).toBe('<3');
    expect(toCardCountBucket(2)).toBe('<3');
    expect(toCardCountBucket(3)).toBe('3-49');
  });

  it('buckets the remaining ranges', () => {
    expect(toCardCountBucket(49)).toBe('3-49');
    expect(toCardCountBucket(50)).toBe('50-499');
    expect(toCardCountBucket(499)).toBe('50-499');
    expect(toCardCountBucket(500)).toBe('500+');
  });
});
