import { describe, expect, it } from 'vitest';

const english = import.meta.glob(
  ['./content/**/*.{md,mdx}', '!./content/de/**'],
  {
    query: '?raw',
    import: 'default',
    eager: true,
  }
) as Record<string, string>;

const german = import.meta.glob('./content/de/**/*.{md,mdx}', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

// Pages that intentionally stay English-only. Legal docs need legal review
// before translation (.claude/docs/i18n.md); the docs home falls back per-file.
const ENGLISH_ONLY = new Set([
  'index.mdx',
  'reference/privacy.md',
  'reference/terms.md',
]);

const englishPaths = Object.keys(english).map((p) =>
  p.replace('./content/', '')
);
const germanPaths = new Set(
  Object.keys(german).map((p) => p.replace('./content/de/', ''))
);

describe('German docs mirror', () => {
  it('has a German page for every English page outside the allowlist', () => {
    const missing = englishPaths.filter(
      (p) => !ENGLISH_ONLY.has(p) && !germanPaths.has(p)
    );
    expect(missing).toEqual([]);
  });

  it('has no German page without an English source', () => {
    const englishSet = new Set(englishPaths);
    const orphaned = [...germanPaths].filter((p) => !englishSet.has(p));
    expect(orphaned).toEqual([]);
  });
});
