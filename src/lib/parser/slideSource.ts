import * as cheerio from 'cheerio';

// The line that answers a PowerPoint slide card with the slide's footer and
// slide number when the back has nothing of its own (see combineSlidesIntoHTML).
export const SLIDE_SOURCE_CLASS = 'slide-source';

// Such a back has no answer to type: everything in it is that line or the
// slide image.
export function hasOnlySlideSource(back: string): boolean {
  if (!back.includes(SLIDE_SOURCE_CLASS)) return false;
  const $ = cheerio.load(back, null, false);
  const sources = $(`.${SLIDE_SOURCE_CLASS}`);
  if (sources.length === 0) return false;
  sources.remove();
  return $.root().text().trim() === '';
}
