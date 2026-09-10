import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ANSWERS_PAGES } from './answersConfig';

const REPO_ROOT = join(__dirname, '../../../..');

function readServerAnswersSlugs(): Set<string> {
  const source = readFileSync(
    join(REPO_ROOT, 'src/routes/knownRoutes.ts'),
    'utf8'
  );
  const block = source.match(
    /const ANSWERS_SLUGS = new Set<string>\(\[([\s\S]*?)\]\);/
  );
  if (block == null) {
    throw new Error('ANSWERS_SLUGS block not found in knownRoutes.ts');
  }
  return new Set(Array.from(block[1].matchAll(/'([a-z0-9-]+)'/g), (m) => m[1]));
}

function readSitemapAnswersSlugs(): Set<string> {
  const sitemap = readFileSync(
    join(REPO_ROOT, 'web/public/sitemap.xml'),
    'utf8'
  );
  return new Set(
    Array.from(
      sitemap.matchAll(
        /<loc>https:\/\/2anki\.net\/answers\/([a-z0-9-]+)\/<\/loc>/g
      ),
      (m) => m[1]
    )
  );
}

describe('answers slug parity', () => {
  const configSlugs = new Set(ANSWERS_PAGES.keys());

  it('every answers page is in the server route allowlist', () => {
    const serverSlugs = readServerAnswersSlugs();
    const missing = [...configSlugs].filter((slug) => !serverSlugs.has(slug));
    expect(missing).toEqual([]);
  });

  it('the server route allowlist has no slug without a page', () => {
    const serverSlugs = readServerAnswersSlugs();
    const orphaned = [...serverSlugs].filter((slug) => !configSlugs.has(slug));
    expect(orphaned).toEqual([]);
  });

  it('every answers page is in the sitemap', () => {
    const sitemapSlugs = readSitemapAnswersSlugs();
    const missing = [...configSlugs].filter((slug) => !sitemapSlugs.has(slug));
    expect(missing).toEqual([]);
  });

  it('the sitemap lists no answers URL without a page', () => {
    const sitemapSlugs = readSitemapAnswersSlugs();
    const orphaned = [...sitemapSlugs].filter((slug) => !configSlugs.has(slug));
    expect(orphaned).toEqual([]);
  });
});
