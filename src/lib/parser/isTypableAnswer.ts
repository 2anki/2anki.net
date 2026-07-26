import * as cheerio from 'cheerio';

const MAX_TYPABLE_ANSWER_LENGTH = 40;
const STRUCTURAL_TAGS =
  'p, div, li, ul, ol, table, img, a, h1, h2, h3, h4, h5, h6';

function extractText(back: string): string {
  return cheerio.load(back).text().trim();
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
