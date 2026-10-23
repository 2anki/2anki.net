import { mergeStoredCardOptions } from './mergeStoredCardOptions';

describe('mergeStoredCardOptions', () => {
  it('fills keys the body omits from the stored options', () => {
    expect(
      mergeStoredCardOptions(
        { template: 'custom', 'block-id-identity': 'true' },
        { deckName: 'Week 1' }
      )
    ).toEqual({
      template: 'custom',
      'block-id-identity': 'true',
      deckName: 'Week 1',
    });
  });

  it('lets the body win for every ordinary key', () => {
    expect(
      mergeStoredCardOptions({ template: 'stored' }, { template: 'custom' })
    ).toEqual({ template: 'custom' });
  });

  it('lets a stored block-id-identity win over the body', () => {
    expect(
      mergeStoredCardOptions(
        { 'block-id-identity': 'true' },
        { 'block-id-identity': 'false' }
      )
    ).toEqual({ 'block-id-identity': 'true' });
  });

  it('leaves block-id-identity to the body when nothing is stored for it', () => {
    expect(
      mergeStoredCardOptions({ template: 'x' }, { 'block-id-identity': 'true' })
    ).toEqual({ template: 'x', 'block-id-identity': 'true' });
  });

  it('ignores a stored pdf-page-range so a legacy row never slices an upload', () => {
    expect(
      mergeStoredCardOptions(
        { 'pdf-page-range': '12-30', template: 'x' },
        { deckName: 'D' }
      )
    ).toEqual({ template: 'x', deckName: 'D' });
  });

  it('ignores stored values that are not strings', () => {
    expect(
      mergeStoredCardOptions(
        { template: 42, nested: { a: 1 }, 'font-size': '20' },
        {}
      )
    ).toEqual({ 'font-size': '20' });
  });

  it.each([null, undefined, 'text', 7, ['a']])(
    'returns the body untouched when the stored value is %p',
    (stored) => {
      expect(mergeStoredCardOptions(stored, { deckName: 'D' })).toEqual({
        deckName: 'D',
      });
    }
  );

  it('never merges a stored pdf-fallback into a conversion', () => {
    expect(
      mergeStoredCardOptions({ 'pdf-fallback': 'single', cloze: 'true' }, {})
    ).toEqual({ cloze: 'true' });
  });
});
