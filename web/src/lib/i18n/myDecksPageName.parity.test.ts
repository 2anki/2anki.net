import { describe, expect, it } from 'vitest';

// Copy that sends people to the saved-deck list must use the page's own name
// (common:downloads.title, "My decks"), not the old "Downloads", in every
// locale. Strings about the browser's downloads folder are deliberately not
// listed here.
const modules = import.meta.glob('./locales/*/*.json', {
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

const KEYS: [namespace: string, key: string, plural: boolean][] = [
  ['monthlyPartial', 'bodySaved', true],
  ['monthlyPartial', 'readyBody', false],
  ['passFirst', 'previewSaved', false],
  ['previews', 'page.alreadyConverting', false],
  ['previews', 'apkg.backToDownloads', false],
  ['errors', 'messages.apkgGone.action', false],
  ['account', 'createAccount.body', false],
  ['account', 'createAccount.bodyNoName', false],
  ['common', 'upload.form.downloadRecoveredNote', false],
  ['search', 'entry.added', false],
];

function read(lang: string, namespace: string, key: string): string {
  const file = modules[`./locales/${lang}/${namespace}.json`]?.default;
  const value = key
    .split('.')
    .reduce<unknown>(
      (node, part) => (node as Record<string, unknown> | undefined)?.[part],
      file
    );
  if (typeof value !== 'string') {
    throw new TypeError(`${lang}/${namespace}:${key} is missing`);
  }
  return value;
}

function placeholders(text: string): string[] {
  return [...text.matchAll(/{{\w+}}/g)].map(([token]) => token).sort();
}

const cases = LANGS.flatMap((lang) =>
  KEYS.flatMap(([namespace, key, plural]) =>
    (plural ? PLURAL_FORMS[lang].map((form) => `${key}_${form}`) : [key]).map(
      (fullKey) => [lang, namespace, fullKey] as const
    )
  )
);

describe('copy that points to the My decks page', () => {
  it.each(cases)('%s %s:%s names the page', (lang, namespace, key) => {
    const pageName = read(lang, 'common', 'downloads.title');
    expect(read(lang, namespace, key)).toContain(pageName);
  });

  it.each(cases)(
    '%s %s:%s keeps the English placeholders',
    (lang, namespace, key) => {
      const englishKey = key.replace(/_(few|many)$/, '_other');
      expect(placeholders(read(lang, namespace, key))).toEqual(
        placeholders(read('en', namespace, englishKey))
      );
    }
  );
});
