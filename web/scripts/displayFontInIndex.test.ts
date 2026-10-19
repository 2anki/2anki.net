import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const webRoot = join(__dirname, '..');

function cssFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return cssFiles(path);
    return name.endsWith('.css') ? [path] : [];
  });
}

describe('display font declaration', () => {
  it('lives in index.html with a same-origin URL for every weight', () => {
    const html = readFileSync(join(webRoot, 'index.html'), 'utf8');
    for (const weight of ['500', '600']) {
      expect(html).toContain(`url('/fonts/Fraunces/Fraunces-${weight}.woff2')`);
    }
  });

  it('is not declared in a bundled stylesheet, which the CDN would serve', () => {
    const declaring = cssFiles(join(webRoot, 'src')).filter((path) =>
      readFileSync(path, 'utf8').includes('@font-face')
    );
    expect(declaring).toEqual([]);
  });
});
