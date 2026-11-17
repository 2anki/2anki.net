import { describe, expect, it } from 'vitest';

const modules = import.meta.glob('./locales/*/semesterRenewal.json', {
  eager: true,
}) as Record<string, { default: Record<string, string> }>;

const LANGS = ['en', 'de', 'es', 'fr', 'it', 'ja', 'nl', 'pl', 'pt', 'ru'];

const TRANSLATED_KEYS = [
  'title',
  'body',
  'confirmEmailFirst',
  'confirmEmailEffects',
];

function strings(lang: string): Record<string, string> {
  return modules[`./locales/${lang}/semesterRenewal.json`].default;
}

describe('Semester Pass renewal copy in every locale', () => {
  it.each(LANGS)('%s has the same keys as English', (lang) => {
    expect(Object.keys(strings(lang)).sort()).toEqual(
      Object.keys(strings('en')).sort()
    );
  });

  it.each(LANGS.filter((lang) => lang !== 'en'))(
    '%s translates the heading, body and confirm-email copy rather than copying English',
    (lang) => {
      for (const key of TRANSLATED_KEYS) {
        expect(strings(lang)[key]).not.toBe(strings('en')[key]);
      }
    }
  );

  it.each(LANGS)(
    '%s says confirming also ends connected app sessions such as Claude',
    (lang) => {
      expect(strings(lang).confirmEmailEffects).toContain('Claude');
    }
  );

  it.each(LANGS)('%s carries no end date in the banner copy', (lang) => {
    expect(strings(lang).title).not.toContain('{{date}}');
    expect(strings(lang).body).not.toContain('{{date}}');
  });

  it.each([
    ['de', 'Verlängerung des Semester Pass'],
    ['nl', 'Verlenging van de Semester Pass'],
  ])('%s names the region with a noun phrase', (lang, label) => {
    expect(strings(lang).aria).toBe(label);
  });
});
