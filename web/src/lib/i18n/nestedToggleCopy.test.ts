import { describe, it, expect } from 'vitest';

type Namespace = Record<string, unknown>;

const namespaces = import.meta.glob<Namespace>('./locales/*/*.json', {
  eager: true,
  import: 'default',
});

const LOCALES = ['en', 'de', 'es', 'fr', 'it', 'ja', 'nl', 'pl', 'pt', 'ru'];

const MAX_ONE_PATH = 'options.max-one-toggle-per-card.description';
const TOGGLE_MODE_HINT_PATH = 'cardOptions.deck.toggleModeHint';

function read(locale: string, file: string, path: string): unknown {
  let node: unknown = namespaces[`./locales/${locale}/${file}.json`];
  for (const key of path.split('.')) {
    node = (node as Namespace)[key];
  }
  return node;
}

describe('nested toggle copy matches the #3515 parser behaviour', () => {
  it.each(LOCALES)(
    '%s keeps the max-one-toggle description and toggle mode hint',
    (locale) => {
      const description = read(locale, 'cardoptions', MAX_ONE_PATH);
      const hint = read(locale, 'common', TOGGLE_MODE_HINT_PATH);
      expect(typeof description).toBe('string');
      expect((description as string).length).toBeGreaterThan(0);
      expect(typeof hint).toBe('string');
      expect((hint as string).length).toBeGreaterThan(0);
    }
  );

  it('the max-one-toggle option says nested toggles stay on the parent back', () => {
    const description = read('en', 'cardoptions', MAX_ONE_PATH) as string;
    expect(description).toContain("stays on the parent card's back");
    expect(description).not.toMatch(/nested toggle into its own card/i);
    expect(description).not.toMatch(/turn every nested toggle/i);
  });

  it('the toggle mode hint says a nested toggle stays on the parent back', () => {
    const hint = read('en', 'common', TOGGLE_MODE_HINT_PATH) as string;
    expect(hint).toContain("stays on the parent card's back");
    expect(hint).not.toMatch(/nested toggles? become/i);
  });
});
