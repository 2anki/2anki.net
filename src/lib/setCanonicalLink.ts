const CANONICAL_LINK = /<link\s+rel="canonical"[^>]*>/;
const HEAD_CLOSE = '</head>';

export function setCanonicalLink(html: string, href: string): string {
  const tag = `<link rel="canonical" href="${href}">`;
  if (CANONICAL_LINK.test(html)) {
    return html.replace(CANONICAL_LINK, tag);
  }
  return html.replace(HEAD_CLOSE, `${tag}${HEAD_CLOSE}`);
}
