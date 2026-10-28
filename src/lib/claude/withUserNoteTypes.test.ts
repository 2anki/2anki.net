import CardOption from '../parser/Settings/CardOption';
import { withUserNoteTypes } from './withUserNoteTypes';

const stockDeck: { name: string; settings: Record<string, unknown> } = {
  name: 'Deck',
  settings: {
    template: 'specialstyle',
    basicModelName: 'n2a-basic',
    clozeModelName: 'n2a-cloze',
    inputModelName: 'n2a-input',
    useNotionId: true,
  },
};

describe('withUserNoteTypes', () => {
  it("carries the user's custom note-type templates and model ids", () => {
    const template = JSON.stringify({
      parent: 'n2a-basic',
      name: 'My Basic',
      front: '{{Front}}',
      back: '{{Back}}',
      styling: '.card {}',
      storageKey: 'n2a-basic',
    });
    const settings = new CardOption({
      template: 'custom',
      basic_model_id: '123',
      'n2a-basic': template,
    });

    const [deck] = withUserNoteTypes([stockDeck], settings);

    expect(deck.settings).toMatchObject({
      template: 'custom',
      basicModelId: '123',
      n2aBasic: settings.n2aBasic,
      useNotionId: true,
    });
    expect((deck.settings.n2aBasic as { name: string }).name).toBe('My Basic');
  });

  it('leaves the stock template and omits ids the user never set', () => {
    const [deck] = withUserNoteTypes([stockDeck], new CardOption({}));

    expect(deck.settings).toEqual(stockDeck.settings);
  });
});
