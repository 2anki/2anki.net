import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const NON_EN_LOCALES = [
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

const PLURAL_SUFFIX = /_(zero|one|two|few|many|other)$/;
const PLACEHOLDER = /{{\s*([^}]+?)\s*}}/g;

function localePath(locale: string, file?: string): string {
  return file ? join(__dirname, locale, file) : join(__dirname, locale);
}

function namespaceFiles(locale: string): string[] {
  return readdirSync(localePath(locale))
    .filter((name) => name.endsWith('.json'))
    .sort();
}

function readNamespace(locale: string, file: string): Record<string, unknown> {
  return JSON.parse(readFileSync(localePath(locale, file), 'utf8')) as Record<
    string,
    unknown
  >;
}

function flatten(
  value: Record<string, unknown>,
  prefix = ''
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, child] of Object.entries(value)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (child != null && typeof child === 'object' && !Array.isArray(child)) {
      Object.assign(out, flatten(child as Record<string, unknown>, path));
    } else if (typeof child === 'string') {
      out[path] = child;
    }
  }
  return out;
}

function baseKey(key: string): string {
  return key.replace(PLURAL_SUFFIX, '');
}

function baseKeySet(flat: Record<string, string>): Set<string> {
  return new Set(Object.keys(flat).map(baseKey));
}

function placeholders(value: string): Set<string> {
  return new Set(Array.from(value.matchAll(PLACEHOLDER), (match) => match[1]));
}

const EN_FILES = namespaceFiles('en');

describe('i18n locale parity with en', () => {
  it('en ships at least one namespace file', () => {
    expect(EN_FILES.length).toBeGreaterThan(0);
  });

  describe.each(NON_EN_LOCALES)('%s', (locale) => {
    it.each(EN_FILES)('has the %s namespace file', (file) => {
      expect(existsSync(localePath(locale, file))).toBe(true);
    });

    it.each(EN_FILES)(
      'shares the same key set as en/%s (plural suffixes exempt)',
      (file) => {
        if (!existsSync(localePath(locale, file))) {
          return;
        }
        const enBase = baseKeySet(flatten(readNamespace('en', file)));
        const localeBase = baseKeySet(flatten(readNamespace(locale, file)));

        const missing = [...enBase].filter((key) => !localeBase.has(key));
        const extra = [...localeBase].filter((key) => !enBase.has(key));

        expect({ missing, extra }).toEqual({ missing: [], extra: [] });
      }
    );

    it.each(EN_FILES)(
      'preserves the exact placeholder set of en/%s',
      (file) => {
        if (!existsSync(localePath(locale, file))) {
          return;
        }
        const enFlat = flatten(readNamespace('en', file));
        const localeFlat = flatten(readNamespace(locale, file));

        const mismatches: Array<{
          key: string;
          en: string[];
          locale: string[];
        }> = [];

        for (const [key, value] of Object.entries(enFlat)) {
          const enPlaceholders = placeholders(value);
          if (enPlaceholders.size === 0) {
            continue;
          }
          const localeValue = localeFlat[key];
          if (localeValue == null) {
            continue;
          }
          const localePlaceholders = placeholders(localeValue);
          const same =
            enPlaceholders.size === localePlaceholders.size &&
            [...enPlaceholders].every((name) => localePlaceholders.has(name));
          if (!same) {
            mismatches.push({
              key,
              en: [...enPlaceholders].sort(),
              locale: [...localePlaceholders].sort(),
            });
          }
        }

        expect(mismatches).toEqual([]);
      }
    );
  });
});
