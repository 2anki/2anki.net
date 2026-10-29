const MEDIA_TAG = /<(img|video|audio|iframe|svg|object|embed|canvas|math)\b/i;
// Only a real tag: a browser reads `<` as markup when a letter or `/` follows,
// so `<>` and `<=>` stay text on the card. `[^<>]` keeps a long run of
// unclosed `<` from rescanning to the end each time, which is quadratic.
const MARKUP_TAG = /<\/?[a-z][^<>]*>/gi;
const INVISIBLE = /&nbsp;|&#160;|&#xa0;|\s/gi;

// Rendered markup can carry no answer at all: an empty paragraph renders as
// `<p class="" id="…"></p>`, which a bare trim calls content. A card whose
// back is only that looks blank in Anki, so it counts as empty here.
export function hasVisibleContent(html: string | null | undefined): boolean {
  if (html == null) {
    return false;
  }
  if (MEDIA_TAG.test(html)) {
    return true;
  }
  return html.replace(MARKUP_TAG, '').replace(INVISIBLE, '').length > 0;
}

export default hasVisibleContent;
