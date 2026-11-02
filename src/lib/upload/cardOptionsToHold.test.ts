import { cardOptionsToHold } from './cardOptionsToHold';

describe('cardOptionsToHold', () => {
  it('keeps the string options a conversion resolved, deck name included', () => {
    expect(
      cardOptionsToHold({
        deckName: 'Biology',
        'global-tags': 'cells',
        cloze: 'false',
      })
    ).toEqual({ deckName: 'Biology', 'global-tags': 'cells', cloze: 'false' });
  });

  it('drops the PDF question, which only a person on the page can answer', () => {
    expect(
      cardOptionsToHold({ 'pdf-fallback': 'ask', 'pdf-page-range': '1-3' })
    ).toEqual({ 'pdf-page-range': '1-3' });
  });

  it('drops values that are not strings', () => {
    expect(
      cardOptionsToHold({ deckName: 'Biology', files: [1], nested: {} })
    ).toEqual({ deckName: 'Biology' });
  });

  it.each([[null], [undefined], ['text'], [['a']], [{}]])(
    'stores nothing for %j',
    (input) => {
      expect(cardOptionsToHold(input)).toBeNull();
    }
  );
});
