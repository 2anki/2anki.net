// HTTP header values must be ISO-8859-1: Node's setHeader throws
// ERR_INVALID_CHAR on anything above U+00FF, and that throw lands after the
// deck is built — the user gets a 400 instead of their download (2026-09-25,
// an em dash in the duplicate-card warning). The warning copy is written for
// a UI, so the common typographic characters get their ASCII twins rather
// than being dropped; anything else outside Latin-1 becomes a space.
const TYPOGRAPHIC_TO_ASCII: ReadonlyArray<[RegExp, string]> = [
  [/[—–‒]/g, '-'],
  [/[‘’‚′]/g, "'"],
  [/[“”„″]/g, '"'],
  [/…/g, '...'],
  [/ /g, ' '],
];

export function latin1HeaderValue(text: string): string {
  let out = text;
  for (const [pattern, replacement] of TYPOGRAPHIC_TO_ASCII) {
    out = out.replace(pattern, replacement);
  }
  // The `u` flag makes this match by code point, so an emoji (a surrogate
  // pair in UTF-16) collapses to one space rather than two.
  // eslint-disable-next-line no-control-regex
  return out.replace(/[^ -~¡-ÿ]/gu, ' ').trim();
}
