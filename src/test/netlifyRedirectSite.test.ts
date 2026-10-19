import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const repoRoot = join(__dirname, '..', '..');

describe('old-host redirect site', () => {
  it('sends every path to the same path on 2anki.net with a forced 301', () => {
    const rules = readFileSync(
      join(repoRoot, 'deploy', 'netlify-redirect', '_redirects'),
      'utf8'
    );
    expect(rules.trim().split(/\s+/)).toEqual([
      '/*',
      'https://2anki.net/:splat',
      '301!',
    ]);
  });

  it('publishes the redirect directory in production only', () => {
    const toml = readFileSync(join(repoRoot, 'netlify.toml'), 'utf8');
    expect(toml).toContain('publish = "deploy/netlify-redirect"');
    expect(toml).not.toContain('[[context.production.redirects]]');
  });
});
