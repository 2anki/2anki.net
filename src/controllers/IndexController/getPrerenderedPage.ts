import fs from 'fs';
import path from 'path';
import { BUILD_DIR } from '../../lib/constants';

const PRERENDERABLE_PATH = /^(\/[a-z0-9-]+)+\/?$/;

// Same reasoning as getIndexFileContents: the deploy rebuilds web/build in
// place under the live process, so each page is read once and kept.
const cachedPages = new Map<string, string>();

export function resetPrerenderedPageCacheForTesting(): void {
  cachedPages.clear();
}

/**
 * The landing pages are prerendered at build time to
 * `web/build/<path>/index.html` with their own title, canonical and copy, so
 * crawlers that do not run JavaScript see the right page instead of the
 * home page shell.
 */
export function getPrerenderedPage(
  requestPath: string,
  buildDir: string = BUILD_DIR
): string | null {
  if (!PRERENDERABLE_PATH.test(requestPath)) {
    return null;
  }
  const pagePath = requestPath.replace(/\/$/, '');
  const cached = cachedPages.get(pagePath);
  if (cached != null) {
    return cached;
  }
  const filePath = path.join(buildDir, pagePath, 'index.html');
  if (!filePath.startsWith(buildDir + path.sep)) {
    return null;
  }
  try {
    const html = fs.readFileSync(filePath, 'utf8');
    cachedPages.set(pagePath, html);
    return html;
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'ENOENT' || code === 'ENOTDIR') {
      return null;
    }
    throw err;
  }
}
