import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

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

const UNLIMITED_WORD =
  /unlimited|unbegrenzt|ilimitad|illimit|無制限|onbeperkt|nieograniczon|безлимит|sans limite/i;
const PREMIUM_WORD = /premium/i;

function values(locale: string): string[] {
  const raw = readFileSync(
    join(__dirname, 'locales', locale, 'account.json'),
    'utf8'
  );
  const found: string[] = [];
  const walk = (node: unknown) => {
    if (typeof node === 'string') {
      found.push(node);
    } else if (node != null && typeof node === 'object') {
      for (const child of Object.values(node as Record<string, unknown>)) {
        walk(child);
      }
    }
  };
  walk(JSON.parse(raw));
  return found;
}

describe('account locale copy names the real plan', () => {
  describe.each(LOCALES)('%s', (locale) => {
    it('does not sell any plan as "Premium"', () => {
      for (const value of values(locale)) {
        expect(value).not.toMatch(PREMIUM_WORD);
      }
    });

    it('does not describe any plan as unlimited', () => {
      for (const value of values(locale)) {
        expect(value).not.toMatch(UNLIMITED_WORD);
      }
    });
  });
});
