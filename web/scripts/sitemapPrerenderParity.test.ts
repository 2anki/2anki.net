import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import {
  emitAnswersPages,
  emitConvertHubPage,
  emitLandingPages,
  emitMetaOnlyPages,
  emitNotionMarketplacePage,
} from './prerenderLandingPages';

const SOURCE_INDEX = `<!DOCTYPE html>
<html>
<head>
  <link rel="canonical" href="https://2anki.net" />
  <title>Create Anki Flashcards - 2anki.net</title>
  <meta name="description" content="Original description">
</head>
<body><div id="root"></div></body>
</html>`;

function emitEverything(): string {
  const buildDir = mkdtempSync(join(tmpdir(), 'parity-'));
  mkdirSync(buildDir, { recursive: true });
  writeFileSync(join(buildDir, 'index.html'), SOURCE_INDEX);
  emitLandingPages(buildDir);
  emitNotionMarketplacePage(buildDir);
  emitConvertHubPage(buildDir);
  emitAnswersPages(buildDir);
  emitMetaOnlyPages(buildDir);
  return buildDir;
}

function sitemapPaths(): string[] {
  const xml = readFileSync(join(__dirname, '../public/sitemap.xml'), 'utf8');
  return [...xml.matchAll(/<loc>https:\/\/2anki\.net([^<]*)<\/loc>/g)].map(
    (m) => m[1]
  );
}

describe('sitemap ↔ prerender parity', () => {
  it('every sitemap URL is prerendered with its own head (no homepage-shell orphans)', () => {
    const buildDir = emitEverything();
    const missing: string[] = [];
    for (const path of sitemapPaths()) {
      if (path === '/') continue;
      const slug = path.replace(/^\//, '').replace(/\/$/, '');
      try {
        readFileSync(join(buildDir, slug, 'index.html'), 'utf8');
      } catch {
        missing.push(path);
      }
    }
    expect(missing).toEqual([]);
  });

  it('every prerendered sitemap page carries a unique title and a self-referencing canonical', () => {
    const buildDir = emitEverything();
    const titles = new Map<string, string>();
    for (const path of sitemapPaths()) {
      if (path === '/') continue;
      const slug = path.replace(/^\//, '').replace(/\/$/, '');
      const html = readFileSync(join(buildDir, slug, 'index.html'), 'utf8');
      const title = /<title>([\s\S]*?)<\/title>/.exec(html)?.[1] ?? '';
      const canonical =
        /<link rel="canonical" href="([^"]*)">/.exec(html)?.[1] ?? '';
      expect(title, `title missing for ${path}`).not.toBe('');
      expect(
        title,
        `duplicate title between ${titles.get(title)} and ${path}`
      ).not.toBe('Create Anki Flashcards - 2anki.net');
      if (titles.has(title)) {
        expect.fail(
          `duplicate title "${title}" on ${titles.get(title)} and ${path}`
        );
      }
      titles.set(title, path);
      const expected = `https://2anki.net${path}`;
      const crossCanonicalized = canonical !== expected;
      if (crossCanonicalized) {
        expect(
          canonical.startsWith('https://2anki.net/'),
          `canonical for ${path} points off-site: ${canonical}`
        ).toBe(true);
        expect(
          canonical,
          `canonical for ${path} falls back to the homepage`
        ).not.toBe('https://2anki.net');
        expect(
          canonical,
          `canonical for ${path} falls back to the homepage`
        ).not.toBe('https://2anki.net/');
      }
    }
  });

  it('sitemap URLs all use the trailing-slash form the server serves without a redirect hop', () => {
    for (const path of sitemapPaths()) {
      expect(path.endsWith('/'), `${path} misses its trailing slash`).toBe(
        true
      );
    }
  });
});
