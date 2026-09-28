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

const FRONTMATTER_OPEN = '---\n';
const FRONTMATTER_CLOSE = '\n---\n';
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

function splitFrontmatter(raw: string): { frontmatter: string; body: string } {
  if (!raw.startsWith(FRONTMATTER_OPEN)) {
    return { frontmatter: '', body: raw };
  }
  const close = raw.indexOf(FRONTMATTER_CLOSE, FRONTMATTER_OPEN.length);
  if (close === -1) {
    return { frontmatter: '', body: raw };
  }
  return {
    frontmatter: raw.slice(FRONTMATTER_OPEN.length, close),
    body: raw.slice(close + FRONTMATTER_CLOSE.length),
  };
}

function readTitle(frontmatter: string): string {
  const line = frontmatter
    .split('\n')
    .find((candidate) => candidate.startsWith('title:'));
  if (line == null) {
    return '';
  }
  const value = line.slice('title:'.length).trim();
  const quoted =
    value.length >= 2 &&
    ((value.startsWith("'") && value.endsWith("'")) ||
      (value.startsWith('"') && value.endsWith('"')));
  return quoted ? value.slice(1, -1) : value;
}

export function renderLegalDocument(raw: string): LegalDocument {
  const { frontmatter, body } = splitFrontmatter(raw);
  return { title: readTitle(frontmatter), html: md.render(body) };
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
