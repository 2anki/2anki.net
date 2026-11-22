const GERMAN_ROUTES: ReadonlySet<string> = new Set([
  '/notion-zu-anki',
  '/pdf-zu-anki',
  '/powerpoint-zu-anki',
]);

const JAPANESE_ROUTES: ReadonlySet<string> = new Set(['/tokushoho']);

const LEGAL_ROUTES: ReadonlySet<string> = new Set([
  '/documentation/reference/privacy',
  '/documentation/reference/terms',
  '/documentation/misc/privacy-policy',
  '/documentation/misc/terms-of-service',
]);

const UNTRANSLATED_SECTIONS: readonly string[] = ['/debug', '/ops'];

const DOCS_PREFIX = '/documentation/';

function isInSection(path: string, section: string): boolean {
  return path === section || path.startsWith(`${section}/`);
}
const LANGUAGES_WITH_TRANSLATED_DOCS: ReadonlySet<string> = new Set(['de']);

function withoutTrailingSlash(pathname: string): string {
  let end = pathname.length;
  while (end > 1 && pathname.codePointAt(end - 1) === 47) end--;
  return pathname.slice(0, end);
}

export function routeDocumentLanguage(
  pathname: string,
  appLanguage: string
): string | null {
  const path = withoutTrailingSlash(pathname);
  if (GERMAN_ROUTES.has(path)) return 'de';
  if (JAPANESE_ROUTES.has(path)) return 'ja';
  if (LEGAL_ROUTES.has(path)) return 'en';
  if (UNTRANSLATED_SECTIONS.some((section) => isInSection(path, section))) {
    return 'en';
  }
  if (
    path.startsWith(DOCS_PREFIX) &&
    !LANGUAGES_WITH_TRANSLATED_DOCS.has(appLanguage)
  ) {
    return 'en';
  }
  return null;
}
