import fs from 'node:fs';
import path from 'node:path';

import { isKnownAppRoute } from './knownRoutes';

// A route that exists in the SPA but not in the server's known-route list
// renders on client-side navigation and 404s on a direct load or refresh.
// That shipped twice (#3528, #3542); this test reads the SPA's route table so
// the pair cannot drift again.
const PARAM_SAMPLES: Record<string, string> = {
  id: '123',
  token: 'abc123',
  key: 'sample-key.apkg',
};

// Slug routes are validated against the server's own slug lists, so the
// sample slug has to be a real one. The lists are module-private; read the
// first entry of each straight from the source, as DefaultRouter.test does.
const SLUG_LISTS: Record<string, string> = {
  '/answers/:slug': 'ANSWERS_SLUGS',
  '/convert/:slug': 'CONVERT_SLUGS',
};

// Dev preview routes are lazy chunks gated on import.meta.env.DEV; they are
// not emitted in the production bundle, so a prod 404 is the intended answer.
const DEV_ONLY_PREFIX = '/dev/';

const knownRoutesSource = fs.readFileSync(
  path.join(__dirname, 'knownRoutes.ts'),
  'utf8'
);

function firstSlug(listName: string): string {
  const match = new RegExp(
    `${listName} = new Set<string>\\(\\[\\s*'([^']+)'`
  ).exec(knownRoutesSource);
  if (match == null) {
    throw new Error(`${listName} not found in knownRoutes.ts`);
  }
  return match[1];
}

// Finds the end of a JSX opening tag, skipping `>` characters that sit inside
// expression containers such as element={<OpsLayout />}.
function tagEnd(source: string, from: number): number {
  let depth = 0;
  for (let i = from; i < source.length; i += 1) {
    const char = source[i];
    if (char === '{') depth += 1;
    else if (char === '}') depth -= 1;
    else if (char === '>' && depth === 0) return i;
  }
  throw new Error('unterminated <Route tag in App.tsx');
}

function resolveRoutePath(
  routePath: string | undefined,
  parent: string
): string | null {
  if (routePath == null || routePath === '*' || routePath === 'index') {
    return null;
  }
  if (routePath.startsWith('/')) {
    return routePath;
  }
  return `${parent}/${routePath}`;
}

// Walks every <Route> in App.tsx, resolving relative child paths against
// their enclosing parent so nested routes like /ops/return-rate are checked.
function appRoutePaths(): string[] {
  const appSource = fs.readFileSync(
    path.join(__dirname, '../../web/src/App.tsx'),
    'utf8'
  );
  const parents: string[] = [];
  const routes: string[] = [];
  const token = /<Route\b|<\/Route>/g;
  let match: RegExpExecArray | null;
  while ((match = token.exec(appSource)) != null) {
    if (match[0] === '</Route>') {
      parents.pop();
      continue;
    }
    const end = tagEnd(appSource, match.index);
    const tag = appSource.slice(match.index, end + 1);
    const selfClosing = appSource[end - 1] === '/';
    const routePath = /path="([^"]+)"/.exec(tag)?.[1];
    const parent = parents[parents.length - 1] ?? '';
    const resolved = resolveRoutePath(routePath, parent);
    if (resolved != null) routes.push(resolved);
    if (!selfClosing) parents.push(resolved ?? parent);
    token.lastIndex = end + 1;
  }
  return routes.filter((route) => !route.startsWith(DEV_ONLY_PREFIX));
}

function concretePath(route: string): string {
  const listName = SLUG_LISTS[route];
  if (listName != null) {
    return route.replace(':slug', firstSlug(listName));
  }
  return route
    .replace(/\/\*$/, '/sample')
    .replace(/:([a-zA-Z]+)/g, (_, name: string) => {
      const sample = PARAM_SAMPLES[name];
      if (sample == null) {
        throw new Error(`add a PARAM_SAMPLES entry for :${name} in ${route}`);
      }
      return sample;
    });
}

describe('SPA routes are known to the server', () => {
  const routes = appRoutePaths();

  it('reads the SPA route table, nested ops tabs included', () => {
    expect(routes.length).toBeGreaterThan(60);
    expect(routes).toContain('/ops/today');
  });

  it.each(routes)('%s is served on a direct load', (route) => {
    expect(isKnownAppRoute(concretePath(route))).toBe(true);
  });

  it('still rejects a slug that is not in the server lists', () => {
    expect(isKnownAppRoute('/answers/not-a-real-slug')).toBe(false);
    expect(isKnownAppRoute('/convert/not-a-real-slug')).toBe(false);
  });
});
