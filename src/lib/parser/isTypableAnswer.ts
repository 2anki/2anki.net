import * as cheerio from 'cheerio';

const MAX_TYPABLE_ANSWER_LENGTH = 40;
const STRUCTURAL_TAGS =
  'p, div, li, ul, ol, table, img, a, h1, h2, h3, h4, h5, h6';

// A plain-text back joins its lines with <br>, which .text() drops, so a
// three-line answer read as one word to type.
function extractText(back: string): string {
  const dom = cheerio.load(back);
  dom('br').replaceWith('\n');
  return dom.text().trim();
}

export function isTypableAnswer(back: string): boolean {
  if (typeof back !== 'string') {
    return false;
  }
  const text = extractText(back);
  if (text.length === 0 || text.length > MAX_TYPABLE_ANSWER_LENGTH) {
    return false;
  }
  if (/[\r\n]/.test(text)) {
    return false;
  }
  return cheerio.load(back)(STRUCTURAL_TAGS).length <= 1;
}

export function typableAnswerText(back: string): string {
  return extractText(back);
}
