import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const robotsTxt = readFileSync(
  resolve(__dirname, '../public/robots.txt'),
  'utf-8'
);

describe('robots.txt', () => {
  it('disallows /rules/ to block bots from walking parser-rule permutations', () => {
    expect(robotsTxt).toContain('Disallow: /rules/');
  });

  it('includes a Sitemap directive', () => {
    expect(robotsTxt).toContain('Sitemap: https://2anki.net/sitemap.xml');
  });

  it('disallows core auth-required app routes', () => {
    expect(robotsTxt).toContain('Disallow: /account');
    expect(robotsTxt).toContain('Disallow: /downloads');
    expect(robotsTxt).toContain('Disallow: /ankify');
    expect(robotsTxt).toContain('Disallow: /card-options');
  });
});

describe('robots.txt landing-page safety', () => {
  it('anchors the /notion disallow so /notion-to-anki stays crawlable', () => {
    expect(robotsTxt).toContain('Disallow: /notion$');
    expect(robotsTxt).not.toMatch(/Disallow: \/notion\n/);
  });
});
