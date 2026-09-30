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

// The SPA's catch-all renders NotFoundPage. The server deliberately 404s an
// unknown path rather than handing it index.html, so it is not a parity gap.
const CATCH_ALL = '/*';

const OPENING_TAG = '<Route';
const CLOSING_TAG = '</Route>';

interface OpeningTag {
  attributes: string;
  nestsChildren: boolean;
  end: number;
}

// The tag ends at the first '>' outside a string or a JSX expression.
// element={requireAuth(<OpsLayout />)} carries both, and the '/>' inside it
// must not be read as the end of the <Route> itself.
const readOpeningTag = (source: string, from: number): OpeningTag => {
  let braceDepth = 0;
  let quote = '';
  for (let index = from; index < source.length; index += 1) {
    const char = source[index];
    if (quote !== '') {
      if (char === quote) {
        quote = '';
      }
    } else if (char === '"' || char === "'") {
      quote = char;
    } else if (char === '{') {
      braceDepth += 1;
    } else if (char === '}') {
      braceDepth -= 1;
    } else if (char === '>' && braceDepth === 0) {
      const attributes = source.slice(from, index);
      return {
        attributes,
        nestsChildren: !attributes.trimEnd().endsWith('/'),
        end: index + 1,
      };
    }
  }
  throw new Error('App.tsx has an unterminated <Route> tag');
};

// '<Routes>' shares the prefix and must not be read as a route declaration.
const nextRouteTag = (source: string, from: number): number => {
  let index = source.indexOf(OPENING_TAG, from);
  while (
    index !== -1 &&
    !/[\s/>]/.test(source[index + OPENING_TAG.length] ?? '')
  ) {
    index = source.indexOf(OPENING_TAG, index + OPENING_TAG.length);
  }
  return index;
};

const resolveAgainstParent = (parent: string, declared: string): string =>
  declared.startsWith('/') ? declared : `${parent}/${declared}`;

// React Router resolves a nested route's path against its parent. The thirteen
// /ops tabs are declared as bare segments ('today', 'flags') and only exist at
// /ops/today, so reading the declared string on its own drops every one of
// them and the test passes without ever asking about them.
const readAppRoutePaths = (): string[] => {
  const source = readFileSync(APP_TSX, 'utf8');
  const declared: string[] = [];
  const parents: string[] = [];
  let cursor = 0;

  while (cursor < source.length) {
    const opening = nextRouteTag(source, cursor);
    const closing = source.indexOf(CLOSING_TAG, cursor);
    if (opening === -1 && closing === -1) {
      break;
    }

    if (opening === -1 || (closing !== -1 && closing < opening)) {
      parents.pop();
      cursor = closing + CLOSING_TAG.length;
      continue;
    }

    const tag = readOpeningTag(source, opening + OPENING_TAG.length);
    const declaredPath = /path="([^"]+)"/.exec(tag.attributes)?.[1];
    const parent = parents[parents.length - 1] ?? '';
    const resolved =
      declaredPath == null
        ? parent
        : resolveAgainstParent(parent, declaredPath);

    if (declaredPath != null) {
      declared.push(resolved);
    }
    if (tag.nestsChildren) {
      parents.push(resolved);
    }
    cursor = tag.end;
  }

  return [...new Set(declared)].filter(
    (path) => path !== CATCH_ALL && !path.startsWith(DEV_ONLY_PREFIX)
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

  // Without parent resolution these thirteen tabs read as bare segments, get
  // dropped, and a fourteenth could ship unserved without failing anything.
  it('resolves a nested route against its parent, not as a bare segment', () => {
    expect(routePaths).toContain('/ops/today');
    expect(routePaths).toContain('/ops/flags');
    expect(routePaths).not.toContain('/today');
  });

  it.each(routePaths)('serves the app for %s on a direct load', (routePath) => {
    expect(isKnownAppRoute(toConcretePath(routePath))).toBe(true);
  });

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
