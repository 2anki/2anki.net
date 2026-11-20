import { describe, expect, it } from 'vitest';

const modules = import.meta.glob('./locales/*/errors.json', {
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

const PLURAL_KEYS = ['usedTitle', 'overTitle'];
const PLAIN_KEYS = ['usage', 'plan'];

function read(lang: string, key: string): string {
  const file = modules[`./locales/${lang}/errors.json`]?.default;
  const messages = file?.messages as Record<string, unknown> | undefined;
  const entry = messages?.monthlyLimit as Record<string, unknown> | undefined;
  const value = entry?.[key];
  if (typeof value !== 'string') {
    throw new TypeError(
      `${lang}/errors:messages.monthlyLimit.${key} is missing`
    );
  }
  return value;
}

function placeholders(text: string): string[] {
  return [...text.matchAll(/{{\w+}}/g)].map(([token]) => token).sort();
}

const cases = LANGS.flatMap((lang) => [
  ...PLURAL_KEYS.flatMap((key) =>
    PLURAL_FORMS[lang].map(
      (form) =>
        [
          lang,
          `${key}_${form}`,
          `${key}_${form === 'one' ? 'one' : 'other'}`,
        ] as const
    )
  ),
  ...PLAIN_KEYS.map((key) => [lang, key, key] as const),
]);

describe('the monthly limit refusal copy in every locale', () => {
  it.each(cases)(
    '%s defines %s with the English placeholders',
    (lang, key, englishKey) => {
      expect(placeholders(read(lang, key))).toEqual(
        placeholders(read('en', englishKey))
      );
    }
  );

  it.each(LANGS)('%s keeps the generic fallback title and detail', (lang) => {
    expect(read(lang, 'title').length).toBeGreaterThan(0);
    expect(read(lang, 'detail').length).toBeGreaterThan(0);
  });
});
