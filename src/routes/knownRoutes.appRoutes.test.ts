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

function appRoutePaths(): string[] {
  const appSource = fs.readFileSync(
    path.join(__dirname, '../../web/src/App.tsx'),
    'utf8'
  );
  return [...appSource.matchAll(/path="([^"]+)"/g)]
    .map((match) => match[1])
    .filter(
      (route) =>
        route.startsWith('/') &&
        route !== '/' &&
        !route.startsWith(DEV_ONLY_PREFIX)
    );
}

function concretePath(route: string): string {
  const listName = SLUG_LISTS[route];
  if (listName != null) {
    return route.replace(':slug', firstSlug(listName));
  }
  return route
    .replace(/\/\*$/, '/sample')
    .replace(/:([a-zA-Z]+)/g, (_, name: string) => PARAM_SAMPLES[name] ?? name);
}

describe('SPA routes are known to the server', () => {
  const routes = appRoutePaths();

  it('reads the SPA route table', () => {
    expect(routes.length).toBeGreaterThan(50);
  });

  it.each(routes)('%s is served on a direct load', (route) => {
    expect(isKnownAppRoute(concretePath(route))).toBe(true);
  });

  it('still rejects a slug that is not in the server lists', () => {
    expect(isKnownAppRoute('/answers/not-a-real-slug')).toBe(false);
    expect(isKnownAppRoute('/convert/not-a-real-slug')).toBe(false);
  });
});
