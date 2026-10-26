import * as cheerio from 'cheerio';

export function toSampleText(html: string): string {
  const $ = cheerio.load(`<div>${html}</div>`);
  $('script, style, noscript').remove();
  $('br, p, li, div, h1, h2, h3, h4, h5, h6, tr').after(' ');
  return $('div').first().text();
}
