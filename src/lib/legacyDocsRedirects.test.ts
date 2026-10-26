import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  LEGACY_DOC_REDIRECTS,
  legacyDocsRedirectTarget,
} from './legacyDocsRedirects';

const SIDEBAR_TS = join(__dirname, '../../web/src/pages/DocsPage/sidebar.ts');

// The client map lives in the web workspace, which the server build cannot
// import, so read it as text: every entry is a 'old': 'new' pair on one line.
function readSidebarRedirects(): Record<string, string> {
  const source = readFileSync(SIDEBAR_TS, 'utf8');
  const block = /export const redirects[^{]*\{([\s\S]*?)\n\};/.exec(source);
  if (block == null) {
    throw new Error('sidebar.ts no longer exports a redirects object');
  }
  const pairs = [...block[1].matchAll(/'([^']+)':\s*'([^']+)'/g)];
  return Object.fromEntries(pairs.map(([, from, to]) => [from, to]));
}

describe('legacy docs redirect map', () => {
  const sidebarRedirects = readSidebarRedirects();

  it('reads the client redirect map', () => {
    expect(Object.keys(sidebarRedirects).length).toBeGreaterThan(20);
  });

  it.each(Object.entries(sidebarRedirects))(
    'sends %s to the same page the client map picks (%s)',
    (from, to) => {
      expect(LEGACY_DOC_REDIRECTS[from]).toBe(`/documentation/${to}/`);
    }
  );
});

describe('legacyDocsRedirectTarget', () => {
  it.each([
    ['/guides/introduction', '/documentation/start-here/what-is-2anki/'],
    ['/guides/introduction/', '/documentation/start-here/what-is-2anki/'],
    ['/guides/getting-started/', '/documentation/start-here/connect-notion/'],
    ['/features/pdf/', '/documentation/reference/file-formats/'],
    ['/features/zip/', '/documentation/reference/file-formats/'],
    ['/features/ppt/', '/documentation/reference/file-formats/'],
    ['/features/xlsx/', '/documentation/reference/file-formats/'],
    ['/features/html/', '/documentation/cards/html/'],
    ['/features/notion-support/', '/documentation/cards/notion-blocks/'],
    [
      '/troubleshooting/common-problems/',
      '/documentation/help/common-problems/',
    ],
    ['/troubleshooting/faq/', '/documentation/help/common-problems/'],
    ['/troubleshooting/limits/', '/documentation/help/limits/'],
    ['/troubleshooting/bug-report/', '/documentation/help/bug-report/'],
    ['/links/youtube/', '/documentation/links/community/'],
    ['/links/anki/', 'https://apps.ankiweb.net/'],
    ['/misc/terms-of-service/', '/documentation/reference/terms/'],
    ['/misc/privacy-policy', '/documentation/reference/privacy/'],
    ['/advanced/self-hosting/', '/documentation/reference/self-hosting/'],
    ['/advanced/api/', '/documentation/reference/mcp/'],
  ])('sends the old docs path %s to %s', (from, to) => {
    expect(legacyDocsRedirectTarget(from)).toBe(to);
  });

  it.each([
    [
      '/documentation/guides/introduction',
      '/documentation/start-here/what-is-2anki/',
    ],
    ['/documentation/features/pdf/', '/documentation/reference/file-formats/'],
    ['/documentation/advanced/api', '/documentation/reference/mcp/'],
    ['/documentation/links/anki', 'https://apps.ankiweb.net/'],
  ])('sends the old slug under /documentation %s to %s', (from, to) => {
    expect(legacyDocsRedirectTarget(from)).toBe(to);
  });

  it.each([
    '/documentation/misc/privacy-policy',
    '/documentation/misc/privacy-policy/',
    '/documentation/misc/terms-of-service',
    '/documentation/misc/terms-of-service/',
  ])(
    'leaves %s alone: Google OAuth branding is registered with that URL',
    (path) => {
      expect(legacyDocsRedirectTarget(path)).toBeUndefined();
    }
  );

  it.each([
    '/',
    '/documentation',
    '/documentation/',
    '/documentation/help/common-problems',
    '/documentation/help/common-problems/',
    '/guides',
    '/features/pdf/extra',
    '/guides/introduction//',
    '/constructor',
    '/documentation/constructor',
    '/upload',
  ])('passes through %s', (path) => {
    expect(legacyDocsRedirectTarget(path)).toBeUndefined();
  });

  it('points every internal target at a page that exists', () => {
    const contentDir = join(__dirname, '../../web/src/pages/DocsPage/content');
    const missing = Object.values(LEGACY_DOC_REDIRECTS)
      .filter((target) => target.startsWith('/documentation/'))
      .map((target) => target.slice('/documentation/'.length, -1))
      .filter((slug) => !existsSync(join(contentDir, `${slug}.md`)));
    expect(missing).toEqual([]);
  });
});
