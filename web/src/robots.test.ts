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

interface RobotsRule {
  allow: boolean;
  pattern: RegExp;
  length: number;
}

function toPattern(value: string): RegExp {
  const anchored = value.endsWith('$');
  const body = (anchored ? value.slice(0, -1) : value)
    .split('*')
    .map((part) => part.replaceAll(/[.+?^${}()|[\]\\]/g, String.raw`\$&`))
    .join('.*');
  return new RegExp(`^${body}${anchored ? '$' : ''}`);
}

function robotsRules(): RobotsRule[] {
  return [...robotsTxt.matchAll(/^(Allow|Disallow):\s*(\S+)\s*$/gm)].map(
    ([, directive, value]) => ({
      allow: directive === 'Allow',
      pattern: toPattern(value),
      length: value.length,
    })
  );
}

function isCrawlable(url: string): boolean {
  const winner = robotsRules()
    .filter((rule) => rule.pattern.test(url))
    .sort((a, b) => b.length - a.length || Number(b.allow) - Number(a.allow))
    .at(0);
  return winner?.allow ?? true;
}

describe('robots.txt lets crawlers read the noindex header on auth pages', () => {
  it.each([
    '/login',
    '/login?redirect=/upload',
    '/register?source=x',
    '/forgot',
    '/auth/magic?token=abc',
    '/users/r/3f9c1a7e-5b2d-4c1e-9a7f-0d2e4b6c8a1f',
    '/account/email-change',
    '/account/email-change?token=abc',
  ])('lets crawlers fetch %s', (url) => {
    expect(isCrawlable(url)).toBe(true);
  });

  it.each(['/account', '/account/', '/account/claim', '/api/users/login'])(
    'keeps crawlers off the signed-in page %s',
    (url) => {
      expect(isCrawlable(url)).toBe(false);
    }
  );

  it('still keeps crawlers off the parser rule pages and the Notion picker', () => {
    expect(isCrawlable('/rules/123')).toBe(false);
    expect(isCrawlable('/notion')).toBe(false);
    expect(isCrawlable('/notion-to-anki')).toBe(true);
  });
});

describe('robots.txt landing-page safety', () => {
  it('anchors the /notion disallow so /notion-to-anki stays crawlable', () => {
    expect(robotsTxt).toContain('Disallow: /notion$');
    expect(robotsTxt).not.toMatch(/Disallow: \/notion\n/);
  });
});
