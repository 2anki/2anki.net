import { describe, expect, it } from 'vitest';

import deCardOptions from '../../lib/i18n/locales/de/cardoptions.json';
import deCommon from '../../lib/i18n/locales/de/common.json';
import enCardOptions from '../../lib/i18n/locales/en/cardoptions.json';
import enCommon from '../../lib/i18n/locales/en/common.json';

const pages = import.meta.glob(
  [
    './content/reference/file-formats.md',
    './content/start-here/upload-a-file.md',
    './content/de/reference/file-formats.md',
    './content/de/start-here/upload-a-file.md',
  ],
  { query: '?raw', import: 'default', eager: true }
) as Record<string, string>;

const LOCALES = [
  {
    language: 'en',
    root: './content/',
    options: enCardOptions.options,
    choices: enCommon.upload.form,
    overlappingCloze: enCommon.cardOptions.overlappingCloze.heading,
  },
  {
    language: 'de',
    root: './content/de/',
    options: deCardOptions.options,
    choices: deCommon.upload.form,
    overlappingCloze: deCommon.cardOptions.overlappingCloze.heading,
  },
];

function lineStartingWith(page: string | undefined, prefix: string): string {
  const line = page?.split('\n').find((text) => text.startsWith(prefix));
  expect(line).toBeDefined();
  return line ?? '';
}

describe('PDF help copy uses the labels the upload page shows', () => {
  it.each(LOCALES)(
    '$language file formats page names the three PDF options',
    ({ root, options }) => {
      const row = lineStartingWith(
        pages[`${root}reference/file-formats.md`],
        '| **PDF**'
      );
      expect(row).toContain(`**${options['pdf-extract-text'].label}**`);
      expect(row).toContain(`**${options['pdf-page-pairs'].label}**`);
      expect(row).toContain(`**${options['claude-ai-flashcards'].label}**`);
    }
  );

  it.each(LOCALES)(
    '$language file formats page names the choices for a PDF without readable text',
    ({ root, choices }) => {
      const row = lineStartingWith(
        pages[`${root}reference/file-formats.md`],
        '| **PDF**'
      );
      expect(row).toContain(`**${choices.pdfChoicePairs}**`);
      expect(row).toContain(`**${choices.pdfChoiceSingle}**`);
      expect(row).toContain(`**${choices.aiRescueMake}**`);
    }
  );

  it.each(LOCALES)(
    '$language upload page names the same choices in its PDF bullet',
    ({ root, choices }) => {
      const bullet = lineStartingWith(
        pages[`${root}start-here/upload-a-file.md`],
        '- **PDF**'
      );
      expect(bullet).toContain(`**${choices.pdfChoicePairs}**`);
      expect(bullet).toContain(`**${choices.pdfChoiceSingle}**`);
      expect(bullet).toContain(`**${choices.aiRescueMake}**`);
    }
  );

  it.each(LOCALES)(
    '$language file formats page names the overlapping cloze option in the Word row',
    ({ root, overlappingCloze }) => {
      const row = lineStartingWith(
        pages[`${root}reference/file-formats.md`],
        '| **Word**'
      );
      expect(row).toContain(`**${overlappingCloze}**`);
    }
  );
});
