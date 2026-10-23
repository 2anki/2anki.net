import { randomUUID } from 'node:crypto';

import Note from '../../lib/parser/Note';
import { buildDeckStyle } from '../../lib/parser/buildDeckStyle';
import CardOption from '../../lib/parser/Settings/CardOption';

function randomDeckId(): number {
  const hex = randomUUID().replace(/-/g, '').slice(0, 13);
  return Number.parseInt(hex, 16) % 1e13;
}

export function buildMindmapDeckInfo(deckName: string, notes: Note[]) {
  return [
    {
      name: deckName,
      image: '',
      style: buildDeckStyle(new CardOption({})),
      id: randomDeckId(),
      settings: {
        template: 'specialstyle',
        clozeModelName: 'n2a-cloze',
        basicModelName: 'n2a-basic',
        inputModelName: 'n2a-input',
        useNotionId: false,
      },
      cards: notes.map((note, index) => ({
        name: note.name,
        back: note.back,
        tags: note.tags,
        cloze: note.cloze,
        number: index,
        enableInput: note.enableInput,
        answer: note.answer,
        media: note.media,
      })),
    },
  ];
}
