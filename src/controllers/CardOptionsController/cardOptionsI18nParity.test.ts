import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import supportedOptions from './supportedOptions';

interface CardOptionsNamespace {
  options: Record<string, { label: string; description: string }>;
}

const EN_CARD_OPTIONS_PATH = join(
  __dirname,
  '../../../web/src/lib/i18n/locales/en/cardoptions.json'
);

const english = JSON.parse(
  readFileSync(EN_CARD_OPTIONS_PATH, 'utf8')
) as CardOptionsNamespace;
const served = supportedOptions();

describe('card option translations', () => {
  it.each(served.map((option) => [option.key, option] as const))(
    'has an English entry matching the server text for %s',
    (key, option) => {
      expect(english.options[key]).toEqual({
        label: option.label,
        description: option.description,
      });
    }
  );

  it('has no English entry for an option the server no longer serves', () => {
    const servedKeys = new Set(served.map((option) => option.key));

    const orphaned = Object.keys(english.options).filter(
      (key) => !servedKeys.has(key)
    );

    expect(orphaned).toEqual([]);
  });

  it('only uses option keys that i18next can address as a path segment', () => {
    const unaddressable = served
      .map((option) => option.key)
      .filter((key) => key.includes('.') || key.includes(':'));

    expect(unaddressable).toEqual([]);
  });
});
