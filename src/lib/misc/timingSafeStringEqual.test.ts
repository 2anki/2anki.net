import { timingSafeStringEqual } from './timingSafeStringEqual';

describe('timingSafeStringEqual', () => {
  it('returns true for identical strings', () => {
    expect(timingSafeStringEqual('s3cr3t-value', 's3cr3t-value')).toBe(true);
  });

  it('returns false when the content differs at the same length', () => {
    expect(timingSafeStringEqual('s3cr3t-value', 's3cr3t-valuX')).toBe(false);
  });

  it('returns false for strings of different lengths without throwing', () => {
    expect(timingSafeStringEqual('short', 'a-much-longer-secret')).toBe(false);
  });

  it('treats the empty string as a distinct value', () => {
    expect(timingSafeStringEqual('', 'x')).toBe(false);
    expect(timingSafeStringEqual('', '')).toBe(true);
  });

  it('distinguishes unicode that collapses under naive comparison', () => {
    expect(timingSafeStringEqual('café', 'cafe')).toBe(false);
  });
});
