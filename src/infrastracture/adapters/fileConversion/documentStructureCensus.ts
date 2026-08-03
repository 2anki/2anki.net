import * as cheerio from 'cheerio';

import { convertDocxToHTML } from './convertDocxToHTML';

export interface DocumentStructureCensus {
  chars: number;
  headings: number;
  paragraphs: number;
  lists: number;
  listItems: number;
  tables: number;
  toggles: number;
  images: number;
}

const TEXTUAL_EXTENSIONS = /\.(html?|md|markdown|txt|csv)$/i;

export function censusFromHtml(html: string): DocumentStructureCensus {
  const $ = cheerio.load(html);
  return {
    chars: html.length,
    headings: $('h1, h2, h3, h4, h5, h6').length,
    paragraphs: $('p').length,
    lists: $('ul, ol').length,
    listItems: $('li').length,
    tables: $('table').length,
    toggles: $('details').length,
    images: $('img').length,
  };
}

export async function censusUploadedFile(file: {
  originalname: string;
  buffer: Buffer | undefined;
}): Promise<DocumentStructureCensus | null> {
  const { originalname, buffer } = file;
  if (buffer == null) {
    return null;
  }
  try {
    if (/\.docx$/i.test(originalname)) {
      return censusFromHtml(await convertDocxToHTML(buffer));
    }
    if (TEXTUAL_EXTENSIONS.test(originalname)) {
      return censusFromHtml(buffer.toString('utf8'));
    }
    return null;
  } catch {
    return null;
  }
}
