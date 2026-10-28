import * as cheerio from 'cheerio';

// Marks the line that answers a PowerPoint slide card with the slide's footer
// and slide number when the back has nothing of its own (see
// combineSlidesIntoHTML). Namespaced, so hand-written HTML does not carry it
// by accident the way it could carry a class.
export const SLIDE_SOURCE_ATTRIBUTE = 'data-2anki-slide-source';

// Such a back has no answer to type: everything in it is that line or the
// slide image.
export function hasOnlySlideSource(back: string): boolean {
  if (!back.includes(SLIDE_SOURCE_ATTRIBUTE)) return false;
  const $ = cheerio.load(back, null, false);
  const sources = $(`[${SLIDE_SOURCE_ATTRIBUTE}]`);
  if (sources.length === 0) return false;
  sources.remove();
  return $.root().text().trim() === '';
}
