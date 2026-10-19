const ALLOWED_LINK_SCHEMES = new Set(['http', 'https', 'mailto']);

function linkScheme(href: string): string | null {
  const compact = href.replace(/\s+/g, '');
  const match = /^([a-z][a-z0-9+.-]*):/i.exec(compact);
  return match ? match[1].toLowerCase() : null;
}

export default function safeLinkHref(
  href: string | null | undefined
): string | null {
  if (href == null) {
    return null;
  }
  const trimmed = href.trim();
  if (trimmed === '') {
    return null;
  }
  const scheme = linkScheme(trimmed);
  if (scheme == null || !ALLOWED_LINK_SCHEMES.has(scheme)) {
    return null;
  }
  return trimmed;
}
