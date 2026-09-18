import { isPlaceholderPageTitle } from './isPlaceholderPageTitle';

describe('isPlaceholderPageTitle', () => {
  it.each(['this page', '  This Page ', 'Diese Seite', 'このページ'])(
    'treats "%s" as a placeholder',
    (title) => {
      expect(isPlaceholderPageTitle(title)).toBe(true);
    }
  );

  it.each(['Organic Chemistry', 'HTML test', 'this page of notes', ''])(
    'keeps the real title "%s"',
    (title) => {
      expect(isPlaceholderPageTitle(title)).toBe(false);
    }
  );

  it('keeps a missing title as missing', () => {
    expect(isPlaceholderPageTitle(null)).toBe(false);
  });
});
