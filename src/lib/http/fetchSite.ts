export type FetchSite =
  | 'none'
  | 'cross-site'
  | 'same-site'
  | 'same-origin'
  | 'absent'
  | 'other';

const KNOWN_FETCH_SITES: ReadonlySet<string> = new Set([
  'none',
  'cross-site',
  'same-site',
  'same-origin',
]);

export function fetchSiteOf(header: string | null | undefined): FetchSite {
  if (header == null) {
    return 'absent';
  }
  const value = header.toLowerCase();
  return KNOWN_FETCH_SITES.has(value) ? (value as FetchSite) : 'other';
}
