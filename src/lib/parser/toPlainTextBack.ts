import * as cheerio from 'cheerio';

const BLOCK_SELECTOR =
  'p, li, summary, details, div, h1, h2, h3, h4, h5, h6, blockquote, pre, tr';

// "Use plain text for back": every block-level piece of the answer becomes one
// line, formatting goes, and lines are joined with <br> so Anki still shows
// them apart. Nested toggles count as blocks, which is how a 2026 Notion export
// lays out one answer per line.
export function toPlainTextBack(html: string): string {
  const $ = cheerio.load(`<div id="plain-root">${html}</div>`, null, false);
  $('br').replaceWith('\n');
  $(BLOCK_SELECTOR).each((_, element) => {
    $(element).append('\n');
  });
  return $('#plain-root')
    .text()
    .split('\n')
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter((line) => line.length > 0)
    .join('<br>');
}
