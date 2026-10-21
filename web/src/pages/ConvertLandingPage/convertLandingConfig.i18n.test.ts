import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { CONVERT_LANDING_PAGES } from './convertLandingConfig';

const LOCALES = [
  'en',
  'de',
  'es',
  'fr',
  'it',
  'ja',
  'nl',
  'pl',
  'pt',
  'ru',
] as const;

const ENGLISH_DEFAULT_CONVERT_SLUGS = new Set<string>([
  'excel-to-anki',
  'word-to-anki',
  'obsidian-to-anki',
  'photo-to-anki',
  'google-slides-to-anki',
  'screenshot-to-anki',
  'google-sheets-to-anki',
  'txt-to-anki',
  'onenote-to-anki',
  'evernote-to-anki',
  'google-docs-to-anki',
]);

interface PageEntry {
  h1?: string;
  subhead?: string;
}

function landingPages(locale: string): Record<string, PageEntry> {
  const file = join(
    __dirname,
    '../../lib/i18n/locales',
    locale,
    'landing.json'
  );
  const json = JSON.parse(readFileSync(file, 'utf8')) as {
    pages?: Record<string, PageEntry>;
  };
  return json.pages ?? {};
}

const localizedSlugs = Array.from(CONVERT_LANDING_PAGES.keys()).filter(
  (slug) => !ENGLISH_DEFAULT_CONVERT_SLUGS.has(slug)
);

describe('convert landing pages localize h1 and subhead', () => {
  it.each(LOCALES)(
    'locale %s has an h1 and subhead for every localized convert slug',
    (locale) => {
      const pages = landingPages(locale);
      const missing = localizedSlugs.filter((slug) => {
        const entry = pages[`convert-${slug}`];
        return entry?.h1 == null || entry?.subhead == null;
      });
      expect(missing).toEqual([]);
    }
  );

  it('keeps the two new Notion intent pages out of the English-default set', () => {
    expect(ENGLISH_DEFAULT_CONVERT_SLUGS.has('notion-toggles-to-anki')).toBe(
      false
    );
    expect(ENGLISH_DEFAULT_CONVERT_SLUGS.has('notion-export-to-anki')).toBe(
      false
    );
    expect(localizedSlugs).toContain('notion-toggles-to-anki');
    expect(localizedSlugs).toContain('notion-export-to-anki');
  });

  it('accounts for every convert slug as localized or English-default', () => {
    for (const slug of Array.from(CONVERT_LANDING_PAGES.keys())) {
      const covered =
        localizedSlugs.includes(slug) ||
        ENGLISH_DEFAULT_CONVERT_SLUGS.has(slug);
      expect(covered, `convert slug ${slug} is unaccounted for`).toBe(true);
    }
  });
});
