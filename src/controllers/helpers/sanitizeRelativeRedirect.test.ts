import { sanitizeRelativeRedirect } from './sanitizeRelativeRedirect';

describe('sanitizeRelativeRedirect', () => {
  it('accepts a simple relative path', () => {
    expect(sanitizeRelativeRedirect('/upload')).toBe('/upload');
  });

  it('accepts a nested relative path', () => {
    expect(sanitizeRelativeRedirect('/notion/some-page-id')).toBe(
      '/notion/some-page-id'
    );
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

  it('rejects a value that does not start with a slash', () => {
    expect(sanitizeRelativeRedirect('upload')).toBeUndefined();
  });

  it('rejects an embedded whitespace/control-character bypass', () => {
    expect(sanitizeRelativeRedirect('/\t//evil.example')).toBeUndefined();
  });

  it('rejects a backslash anywhere in the path', () => {
    expect(sanitizeRelativeRedirect('/foo\\bar')).toBeUndefined();
  });

  it('rejects a bare slash', () => {
    expect(sanitizeRelativeRedirect('/')).toBeUndefined();
  });

  it('returns undefined for a non-string value', () => {
    expect(sanitizeRelativeRedirect(undefined)).toBeUndefined();
    expect(sanitizeRelativeRedirect(null)).toBeUndefined();
    expect(sanitizeRelativeRedirect(42)).toBeUndefined();
  });

  it('returns undefined for an empty string', () => {
    expect(sanitizeRelativeRedirect('')).toBeUndefined();
  });
});
