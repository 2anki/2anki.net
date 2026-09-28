import fs from 'node:fs';
import path from 'node:path';
import MarkdownIt from 'markdown-it';

// Google's OAuth brand check fetches the privacy and terms URLs without running
// JavaScript, and the app is a SPA whose raw HTML is an empty root. These two
// routes get the rendered policy injected into the shell; React replaces it on
// hydration, so browsers see the normal docs page.
export const LEGAL_CONTENT_DIR = path.join(
  __dirname,
  '../../web/src/pages/DocsPage/content/reference'
);

export const LEGAL_ROUTES: Readonly<Record<string, string>> = {
  '/documentation/misc/privacy-policy': 'privacy.md',
  '/documentation/misc/terms-of-service': 'terms.md',
  '/documentation/reference/privacy': 'privacy.md',
  '/documentation/reference/terms': 'terms.md',
};

const md = new MarkdownIt({ html: false, linkify: true });

const FRONTMATTER_RE = /^---\n([\s\S]*?)\n---\n/;
const TITLE_RE = /^title:\s*['"]?(.*?)['"]?\s*$/m;
const ROOT_RE = /<div id="root"><\/div>/;

// The prerender is visible until React mounts; keep it readable rather than
// bare browser-default text in that moment.
const PRERENDER_STYLE =
  'max-width:48rem;margin:0 auto;padding:1rem;font-family:system-ui,sans-serif;line-height:1.5';
const TITLE_TAG_RE = /<title>[^<]*<\/title>/;

export interface LegalDocument {
  title: string;
  html: string;
}

export function renderLegalDocument(raw: string): LegalDocument {
  const match = FRONTMATTER_RE.exec(raw);
  const frontmatter = match?.[1] ?? '';
  const body = match == null ? raw : raw.slice(match[0].length);
  const title = TITLE_RE.exec(frontmatter)?.[1] ?? '';
  return { title, html: md.render(body) };
}

export function injectLegalDocument(
  indexHtml: string,
  doc: LegalDocument
): string {
  const heading =
    doc.title === '' ? '' : `<h1>${md.utils.escapeHtml(doc.title)}</h1>`;
  const withRoot = indexHtml.replace(
    ROOT_RE,
    `<div id="root"><main class="legal-prerender" style="${PRERENDER_STYLE}">${heading}${doc.html}</main></div>`
  );
  if (doc.title === '') {
    return withRoot;
  }
  return withRoot.replace(
    TITLE_TAG_RE,
    `<title>${md.utils.escapeHtml(doc.title)} — 2anki</title>`
  );
}

const cache = new Map<string, LegalDocument>();

export function legalPrerenderFor(
  routePath: string,
  indexHtml: string,
  contentDir: string = LEGAL_CONTENT_DIR
): string | null {
  if (!Object.prototype.hasOwnProperty.call(LEGAL_ROUTES, routePath)) {
    return null;
  }
  const file = LEGAL_ROUTES[routePath];
  const cacheKey = path.join(contentDir, file);
  let doc = cache.get(cacheKey);
  if (doc == null) {
    let raw: string;
    try {
      raw = fs.readFileSync(cacheKey, 'utf8');
    } catch {
      return null;
    }
    doc = renderLegalDocument(raw);
    cache.set(cacheKey, doc);
  }
  return injectLegalDocument(indexHtml, doc);
}
