import { describe, expect, it } from 'vitest';
import { sanitizeRelativeRedirect } from './sanitizeRelativeRedirect';

describe('sanitizeRelativeRedirect', () => {
  it('accepts a simple relative path', () => {
    expect(sanitizeRelativeRedirect('/upload')).toBe('/upload');
  });

  it('accepts a relative path with a query string', () => {
    expect(sanitizeRelativeRedirect('/search?q=anki')).toBe('/search?q=anki');
  });

  it('rejects an absolute https URL', () => {
    expect(sanitizeRelativeRedirect('https://evil.example')).toBeUndefined();
  });

  it('rejects a protocol-relative URL', () => {
    expect(sanitizeRelativeRedirect('//evil.example')).toBeUndefined();
  });

  it('rejects the backslash open-redirect trick', () => {
    expect(sanitizeRelativeRedirect('/\\evil.example')).toBeUndefined();
  });

  it('rejects a javascript: scheme', () => {
    expect(sanitizeRelativeRedirect('javascript:alert(1)')).toBeUndefined();
  });

  it('rejects an embedded whitespace bypass', () => {
    expect(sanitizeRelativeRedirect('/\t//evil.example')).toBeUndefined();
  });

  it('returns undefined for null or undefined', () => {
    expect(sanitizeRelativeRedirect(null)).toBeUndefined();
    expect(sanitizeRelativeRedirect(undefined)).toBeUndefined();
  });

  it('returns undefined for an empty string', () => {
    expect(sanitizeRelativeRedirect('')).toBeUndefined();
  });
});
