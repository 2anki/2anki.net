import fs from 'node:fs';
import path from 'node:path';

import documentationSlugs from './documentationSlugs.json';

// The server cannot import the web workspace, so the docs it serves are listed
// in documentationSlugs.json. A page added to the docs but not to that list
// would 404 on a direct load; this test reads the web sources so it cannot.
const DOCS_DIR = path.join(__dirname, '../../web/src/pages/DocsPage');
const CONTENT_DIR = path.join(DOCS_DIR, 'content');
const DOCS_HOME = 'index.mdx';
const GERMAN_MIRROR = `de${path.sep}`;

const sidebarSource = fs.readFileSync(
  path.join(DOCS_DIR, 'sidebar.ts'),
  'utf8'
);
const [groupsSource, redirectsSource = ''] = sidebarSource.split(
  'export const redirects'
);

const contentSlugs = (): string[] =>
  fs
    .readdirSync(CONTENT_DIR, { recursive: true })
    .map(String)
    .filter((file) => /\.mdx?$/.test(file))
    .filter((file) => file !== DOCS_HOME && !file.startsWith(GERMAN_MIRROR))
    .map((file) =>
      file
        .replace(/\.mdx?$/, '')
        .split(path.sep)
        .join('/')
    )
    .sort();

const sidebarPageSlugs = (): string[] =>
  [...groupsSource.matchAll(/\{[^{}]*?slug:\s*'([^']+)'[^{}]*?\}/g)]
    .filter((match) => !/\bhref:/.test(match[0]))
    .map((match) => match[1])
    .sort();

const redirectKeys = (): string[] =>
  [...redirectsSource.split('};')[0].matchAll(/^\s*'([^']+)':\s*'/gm)]
    .map((match) => match[1])
    .sort();

const FIX =
  'update src/routes/documentationSlugs.json to match the docs in web/src/pages/DocsPage';

describe('documentationSlugs.json stays in step with the docs', () => {
  it('reads a plausible number of docs, so it cannot pass by reading nothing', () => {
    expect(contentSlugs().length).toBeGreaterThan(30);
    expect(sidebarPageSlugs().length).toBeGreaterThan(30);
    expect(redirectKeys().length).toBeGreaterThan(10);
  });

  it('lists every English content file', () => {
    expect([...documentationSlugs.slugs].sort(), FIX).toEqual(contentSlugs());
  });

  it('lists every page in the sidebar', () => {
    expect([...documentationSlugs.slugs].sort(), FIX).toEqual(
      sidebarPageSlugs()
    );
  });

  it('lists every legacy slug the client redirects', () => {
    expect([...documentationSlugs.legacySlugs].sort(), FIX).toEqual(
      redirectKeys()
    );
  });
});
