import { strToU8, zipSync } from 'fflate';

import { buildModernCollection } from './buildModernCollection';

export function buildTinyApkg(front = 'What is 2 + 2?', back = '4'): Buffer {
  const collection = buildModernCollection({
    noteType: {
      id: 1,
      name: 'Basic',
      kind: 0,
      css: '',
      fields: ['Front', 'Back'],
      templates: [{ name: 'Card 1', qfmt: '{{Front}}', afmt: '{{Back}}' }],
    },
    deck: { id: 2, name: 'Arithmetic' },
    note: { id: 10, fields: [front, back] },
    cards: [{ id: 100, ord: 0 }],
  });
  return Buffer.from(
    zipSync({
      'collection.anki21': new Uint8Array(collection),
      media: strToU8('{}'),
    })
  );
}
