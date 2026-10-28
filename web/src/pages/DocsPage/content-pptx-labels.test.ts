import { describe, expect, it } from 'vitest';

import deCardOptions from '../../lib/i18n/locales/de/cardoptions.json';
import enCardOptions from '../../lib/i18n/locales/en/cardoptions.json';

const pages = import.meta.glob(
  [
    './content/reference/file-formats.md',
    './content/de/reference/file-formats.md',
  ],
  { query: '?raw', import: 'default', eager: true }
) as Record<string, string>;

const LOCALES = [
  {
    language: 'en',
    root: './content/',
    options: enCardOptions.options,
    promise: 'never the slide number',
    slideImage: 'shows the slide image as the question',
    sourceLine:
      'plus the slide number, date, and footer on slides with no bullet points or notes',
    where: 'in the card options',
    imageLost: 'the cards lose the slide image',
    question: 'its slide number, date, or footer as the question',
  },
  {
    language: 'de',
    root: './content/de/',
    options: deCardOptions.options,
    promise: 'nie die Foliennummer',
    slideImage: 'zeigt das Folienbild als Frage',
    sourceLine:
      'ohne Stichpunkte und Notizen kommen Foliennummer, Datum und Fußzeile dazu',
    where: 'in den Kartenoptionen',
    imageLost: 'fehlt den Karten das Folienbild',
    question: 'ihre Foliennummer, Datum oder Fußzeile als Frage',
  },
];

function powerPointRow(root: string): string {
  const line = pages[`${root}reference/file-formats.md`]
    ?.split('\n')
    .find((text) => text.startsWith('| **PPT / PPTX**'));
  expect(line).toBeDefined();
  return line ?? '';
}

describe('PowerPoint help copy keeps slide numbers off the front only on the default settings', () => {
  it.each(LOCALES)(
    '$language file formats page names the two options the untitled-slide front depends on',
    ({ root, options }) => {
      const row = powerPointRow(root);

      expect(row).toContain(`**${options['embed-images'].label}**`);
      expect(row).toContain(`**${options['process-pdfs'].label}**`);
    }
  );

  it.each(LOCALES)(
    '$language file formats page does not promise the slide number never fronts a card',
    ({ root, promise }) => {
      expect(powerPointRow(root)).not.toContain(promise);
    }
  );

  it.each(LOCALES)(
    '$language file formats page says a picture slide with no other text shows the slide image',
    ({ root, slideImage }) => {
      expect(powerPointRow(root)).toContain(slideImage);
    }
  );

  it.each(LOCALES)(
    '$language file formats page says a slide with no bullet points or notes gets its slide number, date and footer on the back',
    ({ root, sourceLine }) => {
      expect(powerPointRow(root)).toContain(sourceLine);
    }
  );

  it.each(LOCALES)(
    '$language file formats page says the two options are in the card options',
    ({ root, where }) => {
      expect(powerPointRow(root)).toContain(where);
    }
  );

  it.each(LOCALES)(
    '$language file formats page says the cards lose the slide image with either option off',
    ({ root, imageLost }) => {
      expect(powerPointRow(root)).toContain(imageLost);
    }
  );

  it.each(LOCALES)(
    '$language file formats page says the question can then be the slide number, date or footer',
    ({ root, question }) => {
      expect(powerPointRow(root)).toContain(question);
    }
  );
});
