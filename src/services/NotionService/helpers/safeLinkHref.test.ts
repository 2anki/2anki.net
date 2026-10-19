import safeLinkHref from './safeLinkHref';

describe('safeLinkHref', () => {
  it('keeps an https url', () => {
    expect(safeLinkHref('https://docs.ankiweb.net/')).toBe(
      'https://docs.ankiweb.net/'
    );
  });

  it('keeps an http url', () => {
    expect(safeLinkHref('http://example.com/page')).toBe(
      'http://example.com/page'
    );
  });

  it('keeps a mailto link', () => {
    expect(safeLinkHref('mailto:study@example.com')).toBe(
      'mailto:study@example.com'
    );
  });

  it('matches the scheme case-insensitively', () => {
    expect(safeLinkHref('HTTPS://example.com')).toBe('HTTPS://example.com');
  });

  it('trims surrounding whitespace', () => {
    expect(safeLinkHref('  https://example.com  ')).toBe('https://example.com');
  });

  it('rejects a javascript: url', () => {
    expect(safeLinkHref('javascript:alert(1)')).toBeNull();
  });

  it('rejects a data: url', () => {
    expect(safeLinkHref('data:text/html,<script>alert(1)</script>')).toBeNull();
  });

  it('rejects a javascript: url disguised with embedded whitespace', () => {
    expect(safeLinkHref('java\tscript:alert(1)')).toBeNull();
  });

  it('rejects a relative or scheme-less link', () => {
    expect(safeLinkHref('/2f0abc#block')).toBeNull();
  });

  it('returns null for null, undefined and empty input', () => {
    expect(safeLinkHref(null)).toBeNull();
    expect(safeLinkHref(undefined)).toBeNull();
    expect(safeLinkHref('   ')).toBeNull();
  });
});
