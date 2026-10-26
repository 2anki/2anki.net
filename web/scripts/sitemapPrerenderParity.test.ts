import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import {
  emitAnswersPages,
  emitConvertHubPage,
  emitLandingPages,
  emitMetaOnlyPages,
  emitNotionMarketplacePage,
} from './prerenderLandingPages';
import {
  emitDocsPages,
  SERVER_RENDERED_DOC_SLUGS,
} from './prerenderDocsPages';

// The real shell, so a canonical added back to it or a renamed shell title
// shows up here rather than in Search Console.
const SOURCE_INDEX = readFileSync(join(__dirname, '../index.html'), 'utf8');
const SHELL_TITLE = /<title>([\s\S]*?)<\/title>/.exec(SOURCE_INDEX)?.[1] ?? '';

function emitEverything(): string {
  const buildDir = mkdtempSync(join(tmpdir(), 'parity-'));
  mkdirSync(buildDir, { recursive: true });
  writeFileSync(join(buildDir, 'index.html'), SOURCE_INDEX);
  emitLandingPages(buildDir);
  emitNotionMarketplacePage(buildDir);
  emitConvertHubPage(buildDir);
  emitAnswersPages(buildDir);
  emitMetaOnlyPages(buildDir);
  emitDocsPages(buildDir);
  return buildDir;
}

function allSitemapPaths(): string[] {
  const xml = readFileSync(join(__dirname, '../public/sitemap.xml'), 'utf8');
  return [...xml.matchAll(/<loc>https:\/\/2anki\.net([^<]*)<\/loc>/g)].map(
    (m) => m[1]
  );
}

// The legal pages get their head and body from the server at request time
// (src/lib/legalPrerender.ts, covered by its own tests), not from a file here.
const SERVER_RENDERED_PATHS = new Set(
  [...SERVER_RENDERED_DOC_SLUGS].map((slug) => `/documentation/${slug}/`)
);

function sitemapPaths(): string[] {
  return allSitemapPaths().filter((path) => !SERVER_RENDERED_PATHS.has(path));
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
      expect(
        html.match(/<link\s+rel="canonical"/g),
        `${path} must carry exactly one canonical`
      ).toHaveLength(1);
      expect(title, `title missing for ${path}`).not.toBe('');
      expect(
        title,
        `duplicate title between ${titles.get(title)} and ${path}`
      ).not.toBe(SHELL_TITLE);
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

  it('every prerendered docs page is listed in the sitemap', () => {
    const buildDir = emitEverything();
    const docsDir = join(buildDir, 'documentation');
    const prerendered = readdirSync(docsDir, { recursive: true })
      .map(String)
      .filter((file) => file.endsWith('index.html'))
      .map((file) => {
        const dir = relative(buildDir, join(docsDir, file, '..'));
        return `/${dir.split(sep).join('/')}/`;
      });
    expect(prerendered.length).toBeGreaterThan(40);
    const listed = new Set(sitemapPaths());
    expect(prerendered.filter((path) => !listed.has(path))).toEqual([]);
  });

  it('the shell itself carries no canonical for unprerendered routes to inherit', () => {
    expect(SHELL_TITLE).not.toBe('');
    expect(SOURCE_INDEX).not.toMatch(/<link\s+rel="canonical"/);
  });

  it('sitemap URLs all use the trailing-slash form the server serves without a redirect hop', () => {
    for (const path of allSitemapPaths()) {
      expect(path.endsWith('/'), `${path} misses its trailing slash`).toBe(
        true
      );
    }
  });
});
