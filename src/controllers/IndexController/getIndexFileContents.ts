import path from 'path';
import fs from 'fs';
import { BUILD_DIR } from '../../lib/constants';

// The deploy rebuilds web/build in place (vite empties outDir first) while the
// live color keeps serving from the same checkout, so a per-request disk read
// returned 503 "The site is being updated" on every page load for the length of
// the web build — 1 to 15 per deploy. Each process keeps the first index it
// reads: the page then always matches the asset hashes of the build that
// process booted with, and the blue-green swap is what moves users to the next.
let cachedIndex: string | null = null;

export function resetIndexFileCacheForTesting(): void {
  cachedIndex = null;
}

export const getIndexFileContents = (): string | null => {
  if (cachedIndex != null) return cachedIndex;
  const indexFilePath = path.join(BUILD_DIR, 'index.html');
  try {
    cachedIndex = fs.readFileSync(indexFilePath, 'utf8');
    return cachedIndex;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return null;
    }
    throw err;
  }
};
