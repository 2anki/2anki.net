import { describe, expect, it } from 'vitest';

const modules = import.meta.glob('./locales/*/common.json', {
  eager: true,
}) as Record<string, { default: Record<string, unknown> }>;

const LANGS = ['en', 'de', 'es', 'fr', 'it', 'ja', 'nl', 'pl', 'pt', 'ru'];

const FORM_KEYS = [
  'liveConverting',
  'liveDeckReady',
  'liveEmptyDeck',
  'liveImageOnly',
  'liveError',
  'liveLimitReached',
  'liveLockedPdf',
  'pdfPasswordAria',
  'changeSourceAria',
  'uploadFileAria',
];

const PLURAL_FORMS: Record<string, string[]> = {
  en: ['one', 'other'],
  de: ['one', 'other'],
  es: ['one', 'other'],
  fr: ['one', 'other'],
  it: ['one', 'other'],
  nl: ['one', 'other'],
  pt: ['one', 'other'],
  ja: ['other'],
  pl: ['one', 'few', 'many', 'other'],
  ru: ['one', 'few', 'many', 'other'],
};

function record(value: unknown): Record<string, unknown> {
  return value as Record<string, unknown>;
}

function uploadForm(lang: string): Record<string, unknown> {
  const common = modules[`./locales/${lang}/common.json`].default;
  return record(record(common.upload).form);
}

function walkthroughs(lang: string): Record<string, unknown> {
  const common = modules[`./locales/${lang}/common.json`].default;
  return record(record(common.home).walkthroughs);
}

describe('a11y upload/home i18n key parity', () => {
  it.each(LANGS)('%s defines every non-plural upload.form key', (lang) => {
    const form = uploadForm(lang);
    for (const key of FORM_KEYS) {
      expect(typeof form[key]).toBe('string');
      expect((form[key] as string).length).toBeGreaterThan(0);
    }
  });

  it.each(LANGS)(
    '%s defines the liveDeckReadyCount plural forms with {{count}}',
    (lang) => {
      const form = uploadForm(lang);
      for (const suffix of PLURAL_FORMS[lang]) {
        const value = form[`liveDeckReadyCount_${suffix}`];
        expect(typeof value).toBe('string');
        expect(value).toContain('{{count}}');
      }
    }
  );

  it.each(LANGS)(
    '%s defines home.walkthroughs.playVideo with {{title}}',
    (lang) => {
      const value = walkthroughs(lang).playVideo;
      expect(typeof value).toBe('string');
      expect(value).toContain('{{title}}');
    }
  );
});
