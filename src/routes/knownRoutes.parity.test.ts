import { readFileSync } from 'fs';
import { join } from 'path';
import { isKnownAppRoute } from './knownRoutes';

// A route rendered by the SPA but missing from isKnownAppRoute works on a
// client-side navigation and 404s on a refresh or a pasted link, because the
// server decides there which paths get index.html. That has shipped to
// production twice (#3528, #3542) and is invisible in every other test, since
// the two lists live in different workspaces and nothing compares them.
const APP_TSX = join(__dirname, '../../web/src/App.tsx');

// Dev-only preview routes are lazily imported behind import.meta.env.DEV and
// are not emitted in a production build, so the server is right not to serve
// them.
const DEV_ONLY_PREFIX = '/dev/';

const readAppRoutePaths = (): string[] => {
  const source = readFileSync(APP_TSX, 'utf8');
  const paths = [...source.matchAll(/path="([^"]+)"/g)].map(
    (match) => match[1]
  );
  return [...new Set(paths)].filter(
    (path) => path.startsWith('/') && !path.startsWith(DEV_ONLY_PREFIX)
  );
};

// Two prefixes are allowlisted by slug rather than by shape: the server serves
// only the marketing slugs it knows about, so unknown ones 404 instead of
// rendering an empty page for a crawler. The SPA has a catch-all under each.
// Substituting a real slug asks the intended question of those routes, and any
// segment for the rest.
const REAL_SLUG_BY_PREFIX: Record<string, string> = {
  '/convert/': 'notion-to-anki',
  '/answers/': 'pdf-to-anki',
};

// React Router matches ':id' against any segment; the server list matches a
// prefix. Substituting a concrete value asks the real question: would a
// visitor refreshing this URL be served the app?
const toConcretePath = (routePath: string): string => {
  for (const [prefix, slug] of Object.entries(REAL_SLUG_BY_PREFIX)) {
    if (routePath.startsWith(prefix)) return `${prefix}${slug}`;
  }
  return routePath
    .split('/')
    .map((segment) => (segment.startsWith(':') ? 'sample-value' : segment))
    .join('/')
    .replace(/\/\*$/, '/anything');
};

describe('known app routes stay in step with the SPA router', () => {
  const routePaths = readAppRoutePaths();

  it('finds the route table, so this test cannot pass by reading nothing', () => {
    expect(routePaths.length).toBeGreaterThan(50);
  });

  it.each(readAppRoutePaths())(
    'serves the app for %s on a direct load',
    (routePath) => {
      expect(isKnownAppRoute(toConcretePath(routePath))).toBe(true);
    }
  );

  it('still rejects a path the SPA does not render', () => {
    expect(isKnownAppRoute('/not-a-real-route-xyz')).toBe(false);
  });

  // The allowlists above exist so an unknown marketing slug 404s rather than
  // serving an empty page to a crawler. If that ever becomes a prefix match,
  // this is the test that should fail.
  it.each(['/convert/not-a-real-slug', '/answers/not-a-real-slug'])(
    'still rejects %s, which is allowlisted by slug and not by prefix',
    (path) => {
      expect(isKnownAppRoute(path)).toBe(false);
    }
  );
});
