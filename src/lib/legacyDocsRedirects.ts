// Old documentation slugs from docs.2anki.net and earlier /documentation
// layouts, mapped to the page that replaced them. The keys mirror the client
// map in web/src/pages/DocsPage/sidebar.ts (a parity test keeps them aligned)
// plus the old pages the client map never covered. The Netlify site for the
// old docs host publishes the same mapping in deploy/netlify-redirect/_redirects,
// checked against this map by src/test/netlifyRedirectSite.test.ts.
export const LEGACY_DOC_REDIRECTS: Readonly<Record<string, string>> = {
  'guides/introduction': '/documentation/start-here/what-is-2anki/',
  'guides/getting-started': '/documentation/start-here/connect-notion/',
  'features/notion-support': '/documentation/cards/notion-blocks/',
  'features/markdown': '/documentation/cards/markdown/',
  'features/html': '/documentation/cards/html/',
  'features/csv': '/documentation/reference/file-formats/',
  'features/xlsx': '/documentation/reference/file-formats/',
  'features/zip': '/documentation/reference/file-formats/',
  'features/tsv': '/documentation/reference/file-formats/',
  'features/pdf': '/documentation/reference/file-formats/',
  'features/ppt': '/documentation/reference/file-formats/',
  'troubleshooting/common-problems': '/documentation/help/common-problems/',
  'troubleshooting/limits': '/documentation/help/limits/',
  'troubleshooting/bug-report': '/documentation/help/bug-report/',
  'troubleshooting/contact': '/documentation/help/contact/',
  'troubleshooting/faq': '/documentation/help/common-problems/',
  'advanced/self-hosting': '/documentation/reference/self-hosting/',
  'advanced/domain': '/documentation/reference/glossary/',
  'advanced/terminology': '/documentation/reference/glossary/',
  'advanced/strategy': '/documentation/start-here/what-is-2anki/',
  'advanced/api': '/documentation/reference/mcp/',
  'links/anki': 'https://apps.ankiweb.net/',
  'links/youtube': '/documentation/links/community/',
  'links/support': '/documentation/help/contact/',
  'misc/privacy-policy': '/documentation/reference/privacy/',
  'misc/terms-of-service': '/documentation/reference/terms/',
};

// Google's OAuth brand verification is registered with these two URLs, and
// its checker fetches them without following the SPA, so they keep answering
// 200 with the prerendered policy (see src/lib/legalPrerender.ts).
const REGISTERED_LEGAL_PATHS = new Set([
  '/documentation/misc/privacy-policy',
  '/documentation/misc/terms-of-service',
]);

const DOCUMENTATION_PREFIX = '/documentation/';

const LEGACY_PATHS = new Map<string, string>(
  Object.entries(LEGACY_DOC_REDIRECTS).flatMap(([slug, target]) => [
    [`/${slug}`, target],
    [`${DOCUMENTATION_PREFIX}${slug}`, target],
  ])
);

function withoutTrailingSlash(path: string): string {
  return path.length > 1 && path.endsWith('/') ? path.slice(0, -1) : path;
}

export function legacyDocsRedirectTarget(path: string): string | undefined {
  const exact = withoutTrailingSlash(path);
  if (REGISTERED_LEGAL_PATHS.has(exact)) {
    return undefined;
  }
  return LEGACY_PATHS.get(exact);
}
