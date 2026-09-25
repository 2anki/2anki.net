import { latin1HeaderValue } from './latin1HeaderValue';

describe('latin1HeaderValue', () => {
  it('leaves plain ASCII untouched', () => {
    expect(latin1HeaderValue('3 cards repeat. Convert again.')).toBe(
      '3 cards repeat. Convert again.'
    );
  });

  it('swaps the em dash and curly quotes for their ASCII twins', () => {
    expect(
      latin1HeaderValue('1 card is a duplicate — same answer. It wasn’t “new”.')
    ).toBe('1 card is a duplicate - same answer. It wasn\'t "new".');
  });

  it('keeps Latin-1 letters (accents) as they are', () => {
    expect(latin1HeaderValue('Déjà vu — again')).toBe('Déjà vu - again');
  });

  it('replaces anything else outside Latin-1 with a space', () => {
    expect(latin1HeaderValue('deck 📖 ready')).toBe('deck   ready');
  });

  it('produces a value Node will accept as a header', () => {
    const value = latin1HeaderValue('— ’ “ ” … 📖 日本');
    // eslint-disable-next-line no-control-regex
    expect(value).toMatch(/^[ -~¡-ÿ]*$/);
  });
});
