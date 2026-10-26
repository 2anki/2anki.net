import { setCanonicalLink } from './setCanonicalLink';

describe('setCanonicalLink', () => {
  it('inserts a canonical into a head that has none', () => {
    expect(
      setCanonicalLink(
        '<html><head><title>t</title></head></html>',
        'https://2anki.net/'
      )
    ).toBe(
      '<html><head><title>t</title><link rel="canonical" href="https://2anki.net/"></head></html>'
    );
  });

  it('replaces an existing canonical instead of adding a second', () => {
    expect(
      setCanonicalLink(
        '<head><link rel="canonical" href="https://2anki.net" /></head>',
        'https://2anki.net/documentation/reference/terms/'
      )
    ).toBe(
      '<head><link rel="canonical" href="https://2anki.net/documentation/reference/terms/"></head>'
    );
  });

  it('leaves markup without a head untouched', () => {
    expect(setCanonicalLink('<div></div>', 'https://2anki.net/')).toBe(
      '<div></div>'
    );
  });
});
