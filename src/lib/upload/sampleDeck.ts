export const SAMPLE_DECK_NAME = 'Sample deck — Biology 101';

export const SAMPLE_DECK_FILENAME = 'Sample deck — Biology 101.html';

const CARDS: ReadonlyArray<readonly [string, string]> = [
  ['What is the powerhouse of the cell?', 'The mitochondrion.'],
  [
    'What molecule carries genetic information?',
    'DNA — deoxyribonucleic acid.',
  ],
  ['What process do plants use to make food from sunlight?', 'Photosynthesis.'],
  ['What is the basic unit of life?', 'The cell.'],
  ['What are the building blocks of proteins?', 'Amino acids.'],
  ['What organelle controls the cell’s activities?', 'The nucleus.'],
  ['What is the process of cell division called?', 'Mitosis.'],
  ['What gas do plants take in during photosynthesis?', 'Carbon dioxide.'],
];

function toggle([question, answer]: readonly [string, string]): string {
  return `<details class="toggle" open=""><summary>${question}</summary><div class="indented"><p>${answer}</p></div></details>`;
}

export const SAMPLE_DECK_HTML = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${SAMPLE_DECK_NAME}</title></head><body><article class="page sans"><header><h1 class="page-title">${SAMPLE_DECK_NAME}</h1></header><div class="page-body">${CARDS.map(toggle).join('')}</div></article></body></html>`;
