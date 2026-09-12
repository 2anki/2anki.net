import hasClozeMarkup from './hasClozeMarkup';

describe('hasClozeMarkup', () => {
  it.each([
    ['{{c1::mitochondria}}'],
    ['The <b>{{c2::powerhouse::hint}}</b> of the cell'],
    ['{{c10::multi\nline}}'],
  ])('matches Anki cloze syntax in %s', (text) => {
    expect(hasClozeMarkup(text)).toBe(true);
  });

  it.each([
    ['plain text'],
    ['{{cloze}} template token'],
    ['{{c1:: }}'.replace(' ', '')],
    [undefined],
  ])('ignores %s', (text) => {
    expect(hasClozeMarkup(text as string | undefined)).toBe(false);
  });
});
