export function canonicalUrl(pathname: string): string {
  const withTrailingSlash = pathname.endsWith('/') ? pathname : `${pathname}/`;
  return `https://2anki.net${withTrailingSlash}`;
}
