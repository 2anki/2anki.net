const PLACEHOLDER_PAGE_TITLES = new Set([
  'this page',
  'esta página',
  'cette page',
  'diese seite',
  'ta strona',
  'questa pagina',
  'deze pagina',
  'このページ',
  'эта страница',
]);

export function isPlaceholderPageTitle(title: string | null): boolean {
  return (
    title != null && PLACEHOLDER_PAGE_TITLES.has(title.trim().toLowerCase())
  );
}
