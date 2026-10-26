import { describe, it, expect, beforeAll } from 'vitest';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { emitDocsPages, SERVER_RENDERED_DOC_SLUGS } from './prerenderDocsPages';
import { sidebar } from '../src/pages/DocsPage/sidebar';

const SHELL = `<!DOCTYPE html>
<html lang="en">
<head>
  <title>Convert Notion to Anki Flashcards — 2anki.net</title>
  <meta name="description" content="Shell description">
</head>
<body>
  <div id="root"></div>
</body>
</html>`;

let buildDir: string;
let emitted: string[];

const page = (slug: string): string =>
  readFileSync(join(buildDir, 'documentation', slug, 'index.html'), 'utf8');

const docSlugs = sidebar
  .flatMap((group) => group.items)
  .filter((item) => item.href == null)
  .map((item) => item.slug)
  .filter((slug) => !SERVER_RENDERED_DOC_SLUGS.has(slug));

beforeAll(() => {
  buildDir = mkdtempSync(join(tmpdir(), '2anki-docs-prerender-'));
  writeFileSync(join(buildDir, 'index.html'), SHELL, 'utf8');
  emitted = emitDocsPages(buildDir);
});

describe('emitDocsPages', () => {
  it('writes the docs home and one page per sidebar doc', () => {
    expect(emitted).toHaveLength(docSlugs.length + 1);
    expect(emitted).toContain(join(buildDir, 'documentation', 'index.html'));
    expect(emitted).toContain(
      join(buildDir, 'documentation', 'reference', 'glossary', 'index.html')
    );
  });

  it('leaves the legal pages to the server so they have one body source', () => {
    expect(emitted.some((file) => file.includes('reference/privacy'))).toBe(
      false
    );
    expect(emitted.some((file) => file.includes('reference/terms'))).toBe(
      false
    );
  });

  it('skips the external sidebar links and the German mirror', () => {
    expect(emitted.some((file) => file.includes('links/anki'))).toBe(false);
    expect(emitted.some((file) => file.includes('/de/'))).toBe(false);
  });

  it('gives a doc its own title, description and self canonical', () => {
    const html = page('start-here/connect-notion');
    expect(html).toContain(
      '<title>Connect Notion in 5 minutes — 2anki docs</title>'
    );
    expect(html).toContain(
      '<meta name="description" content="From signing in to your first deck downloaded.">'
    );
    expect(html).toContain(
      '<link rel="canonical" href="https://2anki.net/documentation/start-here/connect-notion/">'
    );
    expect(html.match(/<link\s+rel="canonical"/g)).toHaveLength(1);
  });

  it('renders the markdown body into the root so crawlers without JS read it', () => {
    const html = page('start-here/connect-notion');
    expect(html).not.toContain('<div id="root"></div>');
    expect(html).toContain('<h1>Connect Notion in 5 minutes</h1>');
    expect(html).toContain(
      '<h2 id="what-if-a-page-wont-show-up">What if a page won&#x27;t show up?</h2>'
    );
    expect(html).toContain(
      '<a href="/documentation/start-here/open-in-anki">Open your deck in Anki</a>'
    );
  });

  it('drops callout fences instead of printing them as text', () => {
    const html = page('start-here/upload-a-file');
    expect(html).not.toContain(':::');
  });

  it('gives the docs home its title, a self canonical and links to every doc', () => {
    const html = readFileSync(
      join(buildDir, 'documentation', 'index.html'),
      'utf8'
    );
    expect(html).toContain('<title>Documentation — 2anki docs</title>');
    expect(html).toContain(
      '<link rel="canonical" href="https://2anki.net/documentation/">'
    );
    for (const slug of docSlugs) {
      expect(html).toContain(`href="/documentation/${slug}/"`);
    }
  });

  it.each(docSlugs)(
    '%s has its own docs title, not the generic one',
    (slug) => {
      const title = /<title>([^<]*)<\/title>/.exec(page(slug))?.[1];
      expect(title).toMatch(/ — 2anki docs$/);
      expect(title).not.toBe('Documentation — 2anki docs');
    }
  );
});
