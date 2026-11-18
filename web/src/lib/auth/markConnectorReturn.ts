const PRICING_PATHS: ReadonlySet<string> = new Set(['/pricing', '/pricing/']);
const SAME_SITE_BASE = 'https://2anki.invalid';

export function markConnectorReturn(
  redirect: string | undefined
): string | undefined {
  if (redirect == null) {
    return redirect;
  }
  const url = new URL(redirect, SAME_SITE_BASE);
  if (
    !PRICING_PATHS.has(url.pathname) ||
    url.searchParams.get('ref') !== 'mcp'
  ) {
    return redirect;
  }
  url.searchParams.set('r', '1');
  return `${url.pathname}${url.search}${url.hash}`;
}
