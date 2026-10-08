import { describe, expect, it } from 'vitest';

const downloadsx = import.meta.glob('./locales/*/downloadsx.json', {
  eager: true,
}) as Record<string, { default: Record<string, unknown> }>;

const common = import.meta.glob('./locales/*/common.json', {
  eager: true,
}) as Record<string, { default: Record<string, unknown> }>;

const LANGS = ['en', 'de', 'es', 'fr', 'it', 'ja', 'nl', 'pl', 'pt', 'ru'];

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

function imageDrop(lang: string): Record<string, unknown> {
  return record(
    downloadsx[`./locales/${lang}/downloadsx.json`].default.imageDrop
  );
}

function downloadsBadge(lang: string): Record<string, unknown> {
  const c = common[`./locales/${lang}/common.json`].default;
  return record(record(c.downloads).badge);
}

describe('image-drop notice i18n key parity', () => {
  it.each(LANGS)(
    '%s defines the notionHtmlUpload plural forms with {{count}} and .zip',
    (lang) => {
      const keys = imageDrop(lang);
      for (const suffix of PLURAL_FORMS[lang]) {
        const value = keys[`notionHtmlUpload_${suffix}`];
        expect(typeof value).toBe('string');
        expect(value).toContain('{{count}}');
        expect(value).toContain('.zip');
      }
    }
  );

  it.each(LANGS)('%s defines downloads.badge.imagesMissing', (lang) => {
    const value = downloadsBadge(lang).imagesMissing;
    expect(typeof value).toBe('string');
    expect((value as string).length).toBeGreaterThan(0);
  });
});
