import { isKnownAppRoute } from './knownRoutes';

describe('isKnownAppRoute', () => {
  it.each([
    '/',
    '/upload',
    '/pricing',
    '/about',
    '/convert',
    '/notion-marketplace',
    '/notion-to-anki',
    '/notion-zu-anki',
    '/quizlet-to-anki',
    '/convert/csv-to-anki',
    '/answers/fsrs-explained',
    '/answers/pdf-to-anki',
    '/answers/convert-notion-to-anki',
    '/answers/claude-to-anki',
    '/account',
    '/account/claim',
    '/ankify',
    '/ankify/setup',
    '/ops',
    '/ops/flags',
    '/documentation',
    '/documentation/start-here/connect-notion',
    '/security',
    '/contact',
    '/whats-new',
    '/auth/magic',
    '/s/abc123',
    '/users/r/42',
    '/rules/7',
    '/preview/9',
    '/mindmaps/4',
    '/templates/edit/3',
  ])('returns true for known route %s', (path) => {
    expect(isKnownAppRoute(path)).toBe(true);
  });

  it.each([
    '/wp-content/',
    '/wp-includes/l10n/',
    '/.env.backup',
    '/convert/not-a-real-thing',
    '/convert/enrich-anki-deck',
    '/answers/not-a-real-answer',
    '/notion-to-ank',
    '/random-garbage',
    '/rules/',
    '/preview/',
    '/s/',
  ])('returns false for unknown route %s', (path) => {
    expect(isKnownAppRoute(path)).toBe(false);
  });

  it('tolerates a trailing slash on a known route', () => {
    expect(isKnownAppRoute('/pricing/')).toBe(true);
    expect(isKnownAppRoute('/convert/csv-to-anki/')).toBe(true);
    expect(isKnownAppRoute('/answers/fsrs-explained/')).toBe(true);
  });
});
