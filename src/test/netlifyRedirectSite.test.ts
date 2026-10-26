import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { LEGACY_DOC_REDIRECTS } from '../lib/legacyDocsRedirects';

const repoRoot = join(__dirname, '..', '..');

function readRules(): string[][] {
  return readFileSync(
    join(repoRoot, 'deploy', 'netlify-redirect', '_redirects'),
    'utf8'
  )
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '' && !line.startsWith('#'))
    .map((line) => line.split(/\s+/));
}

function absolute(target: string): string {
  return target.startsWith('https://') ? target : `https://2anki.net${target}`;
}

describe('old-host redirect site', () => {
  it('ends with a forced 301 of every other path to the same path on 2anki.net', () => {
    const rules = readRules();
    expect(rules[rules.length - 1]).toEqual([
      '/*',
      'https://2anki.net/:splat',
      '301!',
    ]);
    expect(rules.filter(([from]) => from === '/*')).toHaveLength(1);
  });

  it('sends each old docs path, with and without the slash, straight to its final page', () => {
    const expected = Object.entries(LEGACY_DOC_REDIRECTS).flatMap(
      ([slug, target]) => [
        [`/${slug}`, absolute(target), '301!'],
        [`/${slug}/`, absolute(target), '301!'],
      ]
    );
    expect(readRules().slice(0, -1)).toEqual(expected);
  });

  it('publishes the redirect directory in production only', () => {
    const toml = readFileSync(join(repoRoot, 'netlify.toml'), 'utf8');
    expect(toml).toContain('publish = "deploy/netlify-redirect"');
    expect(toml).not.toContain('[[context.production.redirects]]');
  });
});
