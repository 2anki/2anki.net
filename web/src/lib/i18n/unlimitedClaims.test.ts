import { describe, it, expect } from 'vitest';

type Namespace = Record<string, unknown>;

const namespaces = import.meta.glob<Namespace>('./locales/*/*.json', {
  eager: true,
  import: 'default',
});

const LOCALES = ['en', 'de', 'es', 'fr', 'it', 'ja', 'nl', 'pl', 'pt', 'ru'];

const UNLIMITED_WORD =
  /unlimited|unbegrenzt|ilimitad|illimit|無制限|onbeperkt|nieograniczon|безлимит|sans limite/i;

function read(locale: string, file: string, path: string): string {
  let node: unknown = namespaces[`./locales/${locale}/${file}.json`];
  for (const key of path.split('.')) {
    node = (node as Namespace)[key];
  }
  return node as string;
}

const PLURAL_SUFFIXES = ['_zero', '_one', '_two', '_few', '_many', '_other'];

function readVariants(locale: string, file: string, path: string): string[] {
  const exact = read(locale, file, path);
  if (typeof exact === 'string') {
    return [exact];
  }
  return PLURAL_SUFFIXES.map((suffix) =>
    read(locale, file, `${path}${suffix}`)
  ).filter((value): value is string => typeof value === 'string');
}

const CAPPED_FEATURE_STRINGS: Array<[string, string]> = [
  ['tools', 'photo.quotaReached'],
  ['tools', 'mindmaps.monthlyLimit'],
  ['tools', 'mindmaps.limitSubheading'],
  ['tools', 'import.upgradeUnlimitedImports'],
  ['marketing', 'nativeApp.faq1A'],
];

describe('capped features are not sold as unlimited', () => {
  describe.each(LOCALES)('%s', (locale) => {
    it.each(CAPPED_FEATURE_STRINGS)('%s %s', (file, path) => {
      const variants = readVariants(locale, file, path);
      expect(variants.length).toBeGreaterThan(0);
      for (const value of variants) {
        expect(value).not.toMatch(UNLIMITED_WORD);
      }
    });

    it('the Pro plan card says how many AI credits it includes', () => {
      expect(read(locale, 'common', 'pricing.unlimited.benefitAi')).toContain(
        '300'
      );
    });
  });
});
