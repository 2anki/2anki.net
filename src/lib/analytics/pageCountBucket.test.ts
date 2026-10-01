import { toPageCountBucket } from './pageCountBucket';

describe('toPageCountBucket', () => {
  it('buckets short documents together', () => {
    expect(toPageCountBucket(1)).toBe('1-5');
    expect(toPageCountBucket(5)).toBe('1-5');
    expect(toPageCountBucket(6)).toBe('6-20');
  });

  it('buckets the remaining ranges on the same boundaries the log read used', () => {
    expect(toPageCountBucket(20)).toBe('6-20');
    expect(toPageCountBucket(21)).toBe('21-50');
    expect(toPageCountBucket(50)).toBe('21-50');
    expect(toPageCountBucket(51)).toBe('51-100');
    expect(toPageCountBucket(100)).toBe('51-100');
    expect(toPageCountBucket(101)).toBe('100+');
  });
});
