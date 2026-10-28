import type CardOption from '../parser/Settings/CardOption';

type NoteTypeSettings = Pick<
  CardOption,
  | 'template'
  | 'basicModelName'
  | 'clozeModelName'
  | 'inputModelName'
  | 'basicModelId'
  | 'clozeModelId'
  | 'inputModelId'
  | 'n2aBasic'
  | 'n2aCloze'
  | 'n2aInput'
>;

// Claude's decks come back with the stock template and note-type names. An
// upload has the user's card settings, so the AI deck uses their template and
// note types the way a parser deck does, instead of the stock ones.
export function withUserNoteTypes<
  T extends { settings: Record<string, unknown> },
>(decks: T[], settings: NoteTypeSettings): T[] {
  const noteTypes: Record<string, unknown> = {
    basicModelName: settings.basicModelName,
    clozeModelName: settings.clozeModelName,
    inputModelName: settings.inputModelName,
  };
  const optional = {
    template: settings.template,
    basicModelId: settings.basicModelId,
    clozeModelId: settings.clozeModelId,
    inputModelId: settings.inputModelId,
    n2aBasic: settings.n2aBasic,
    n2aCloze: settings.n2aCloze,
    n2aInput: settings.n2aInput,
  };
  for (const [key, value] of Object.entries(optional)) {
    if (value != null && value !== '') {
      noteTypes[key] = value;
    }
  }
  return decks.map((deck) => ({
    ...deck,
    settings: { ...deck.settings, ...noteTypes },
  }));
}
