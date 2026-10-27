import { describe, expect, it } from 'vitest';

const modules = import.meta.glob('./locales/*/common.json', {
  eager: true,
}) as Record<string, { default: Record<string, unknown> }>;

const LANGS = ['en', 'de', 'es', 'fr', 'it', 'ja', 'nl', 'pl', 'pt', 'ru'];

const TITLE_KEYS = [
  'pdfChoiceTitleLocked',
  'pdfChoiceTitleNoText',
  'pdfChoiceTitleOverSplit',
];

const BODY_KEYS = [
  'pdfChoiceBodyLocked',
  'pdfChoiceBodyNoText',
  'pdfChoiceBodyOverSplit',
];

function uploadForm(lang: string): Record<string, unknown> {
  const common = modules[`./locales/${lang}/common.json`].default;
  const upload = common.upload as Record<string, unknown>;
  return upload.form as Record<string, unknown>;
}

describe('PDF choice copy for each reason', () => {
  it.each(LANGS)('%s defines a title and body for every reason', (lang) => {
    const form = uploadForm(lang);
    for (const key of [...TITLE_KEYS, ...BODY_KEYS, 'pdfChoiceTitle']) {
      expect(typeof form[key]).toBe('string');
      expect((form[key] as string).length).toBeGreaterThan(0);
    }
  });

  it.each(LANGS)(
    '%s gives each reason its own title, and announces none of them',
    (lang) => {
      const form = uploadForm(lang);
      const titles = TITLE_KEYS.map((key) => form[key]);
      expect(new Set(titles).size).toBe(TITLE_KEYS.length);
      expect(new Set(BODY_KEYS.map((key) => form[key])).size).toBe(
        BODY_KEYS.length
      );
      expect(titles).not.toContain(form.pdfChoiceTitle);
    }
  );
});
