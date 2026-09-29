import * as cheerio from 'cheerio';
import { escapeHtml } from '../notion-render/escape';

const BLOCK_SELECTOR =
  'p, li, ul, ol, summary, details, div, h1, h2, h3, h4, h5, h6, blockquote, pre, tr';

// "Use plain text for back": every block-level piece of the answer becomes one
// line, formatting goes, and lines are joined with <br> so Anki still shows
// them apart. Nested toggles count as blocks, which is how a 2026 Notion export
// lays out one answer per line.
export function toPlainTextBack(html: string): string {
  // Fragment mode with no wrapper: a stray close tag left by the legacy
  // nested-toggle cleanup would otherwise end the wrapper early and drop the
  // rest of the answer.
  const $ = cheerio.load(html, null, false);
  $('script, style').remove();
  $('br').replaceWith('\n');
  $('td, th').each((_, cell) => {
    $(cell).append(' ');
  });
  // A newline on both sides of every block, so a parent's own text is cut
  // off before its nested list starts.
  $(BLOCK_SELECTOR).each((_, element) => {
    $(element).prepend('\n').append('\n');
  });
  // .text() decodes entities and the result goes back into card HTML, so a
  // literal "<script>" typed as text on the page is escaped again per line.
  return $.root()
    .text()
    .split('\n')
    .map((line) => escapeHtml(line.replace(/\s+/g, ' ').trim()))
    .filter((line) => line.length > 0)
    .join('<br>');
}
