import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(__dirname, '../../..');
const MIGRATIONS_DIR = path.join(ROOT, 'migrations');
const SRC_DIR = path.join(ROOT, 'src');

// Read through the flag repository directly rather than getFeatureFlag, so the
// literal scan cannot see it; its row already exists on prod and is flippable.
const NOT_SEEDED_ON_PURPOSE = new Set(['pricing_v2']);

function sourceFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      return sourceFiles(full);
    }
    const isSource =
      /\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name);
    return isSource ? [full] : [];
  });
}

function flagKeysReadInCode(): Map<string, string> {
  const keys = new Map<string, string>();
  const constant = /\bconst\s+[A-Z0-9_]+_FLAG\s*=\s*'([a-z0-9_]+)'/g;
  const literal = /getFeatureFlag\(\s*'([a-z0-9_]+)'/g;
  for (const file of sourceFiles(SRC_DIR)) {
    const text = fs.readFileSync(file, 'utf8');
    for (const pattern of [constant, literal]) {
      for (const match of text.matchAll(pattern)) {
        keys.set(match[1], path.relative(ROOT, file));
      }
    }
  }
  return keys;
}

function seededKeys(): Set<string> {
  const seeded = new Set<string>();
  for (const file of fs.readdirSync(MIGRATIONS_DIR)) {
    if (!file.endsWith('.js')) continue;
    const text = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8');
    if (!text.includes("'feature_flags'")) continue;
    for (const match of text.matchAll(/key:\s*'([a-z0-9_]+)'/g)) {
      seeded.add(match[1]);
    }
  }
  return seeded;
}

describe('feature flag seed migrations', () => {
  it('finds the flags the code reads', () => {
    expect(flagKeysReadInCode().has('limit_wall_pro_price')).toBe(true);
  });

  it('has a seed migration for every flag key the code reads', () => {
    const seeded = seededKeys();
    const missing = [...flagKeysReadInCode()]
      .filter(([key]) => !seeded.has(key) && !NOT_SEEDED_ON_PURPOSE.has(key))
      .map(([key, file]) => `${key} (read in ${file})`);

    expect(missing).toEqual([]);
  });
});
