import * as cheerio from 'cheerio';

export function toSampleText(html: string): string {
  return cheerio.load(`<div>${html}</div>`)('div').text();
}
