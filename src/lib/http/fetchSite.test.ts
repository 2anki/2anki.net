import { fetchSiteOf } from './fetchSite';

describe('fetchSiteOf', () => {
  it.each([
    ['none', 'none'],
    ['cross-site', 'cross-site'],
    ['same-site', 'same-site'],
    ['same-origin', 'same-origin'],
    ['Cross-Site', 'cross-site'],
  ])('maps %s to %s', (header, expected) => {
    expect(fetchSiteOf(header)).toBe(expected);
  });

  it.each([undefined, null])(
    'maps a missing header (%j) to absent',
    (header) => {
      expect(fetchSiteOf(header)).toBe('absent');
    }
  );

  it.each(['', 'evil', 'cross-site, none', 'none\r\nx: y', 'x'.repeat(5000)])(
    'maps %j to other',
    (header) => {
      expect(fetchSiteOf(header)).toBe('other');
    }
  );
});
