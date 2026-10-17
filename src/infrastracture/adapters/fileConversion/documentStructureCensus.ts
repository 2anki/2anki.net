import * as cheerio from 'cheerio';
import { logFileLabel } from '../../../lib/logging/logFileLabel';
import { unzipSync } from 'fflate';

import { convertDocxToHTML } from './convertDocxToHTML';
import { isZipContentFileSupported } from '../../../usecases/uploads/isZipContentFileSupported';

export interface DocumentStructureCensus {
  chars: number;
  words: number;
  headings: number;
  paragraphs: number;
  lists: number;
  listItems: number;
  tables: number;
  toggles: number;
  images: number;
}

const TEXTUAL_EXTENSIONS = /\.(html?|md|markdown|txt|csv)$/i;

export interface ZipEntryCensus {
  name: string;
  size: number;
  supported: boolean;
}

export interface ZipStructureCensus {
  kind: 'zip';
  unreadable?: boolean;
  entryCount: number;
  nestedZipCount: number;
  supportedCount: number;
  unsupportedCount: number;
  imageCount: number;
  truncated: boolean;
  entries: ZipEntryCensus[];
}

const ZIP_CENSUS_MAX_ENTRIES = 50;
const IMAGE_ENTRY = /\.(png|jpe?g|gif|webp|bmp|svg|heic|tiff?)$/i;

// A zip made on macOS carries a __MACOSX/ twin of every entry plus ._ resource
// forks; they are metadata, not pages or images the user put in.
function isResourceForkEntry(name: string): boolean {
  return name.startsWith('__MACOSX/') || /(^|\/)\._[^/]*$/.test(name);
}

// Central-directory walk only — the filter always returns false, so no entry
// ever inflates and a zip bomb cannot hurt the diagnostics path.
export function censusZipEntries(buffer: Buffer): ZipStructureCensus {
  const all: { name: string; size: number }[] = [];
  try {
    unzipSync(new Uint8Array(buffer), {
      filter: (file) => {
        if (!file.name.endsWith('/')) {
          all.push({ name: file.name, size: file.originalSize });
        }
        return false;
      },
    });
  } catch {
    return {
      kind: 'zip',
      unreadable: true,
      entryCount: 0,
      nestedZipCount: 0,
      supportedCount: 0,
      unsupportedCount: 0,
      imageCount: 0,
      truncated: false,
      entries: [],
    };
  }

  const content = all.filter((e) => !isResourceForkEntry(e.name));
  const nested = content.filter((e) => /\.zip$/i.test(e.name));
  const flat = content.filter((e) => !/\.zip$/i.test(e.name));
  const entries = content.slice(0, ZIP_CENSUS_MAX_ENTRIES).map((e) => ({
    name: logFileLabel(e.name),
    size: e.size,
    supported: Boolean(isZipContentFileSupported(e.name)),
  }));

  return {
    kind: 'zip',
    entryCount: content.length,
    nestedZipCount: nested.length,
    supportedCount: flat.filter((e) => isZipContentFileSupported(e.name))
      .length,
    unsupportedCount: flat.filter((e) => !isZipContentFileSupported(e.name))
      .length,
    imageCount: flat.filter((e) => IMAGE_ENTRY.test(e.name)).length,
    truncated: content.length > ZIP_CENSUS_MAX_ENTRIES,
    entries,
  };
}

// Single linear pass over the markup with head, style and script removed, so a
// Notion export's embedded CSS never counts as prose. A "<" opens a tag only
// when a tag name, "/" or "!" follows, so "x < 5" in a text file stays words.
// &nbsp; splits words like a space and a bare entity such as &amp; is not a
// word. A scanner rather than a regex replace keeps a megabyte of "<<<<" with
// no closing ">" linear on the request path.
function countWords(html: string): number {
  let words = 0;
  let inTag = false;
  let token = '';
  const flush = () => {
    if (token !== '' && !/^&[a-z#0-9]+;$/i.test(token)) {
      words += 1;
    }
    token = '';
  };
  const text = html.replace(/&nbsp;/g, ' ');
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (inTag) {
      if (char === '>') inTag = false;
      continue;
    }
    if (char === '<' && /[A-Za-z/!]/.test(text[i + 1] ?? '')) {
      inTag = true;
      flush();
      continue;
    }
    if (/\s/.test(char)) {
      flush();
      continue;
    }
    token += char;
  }
  flush();
  return words;
}

function proseMarkup($: cheerio.CheerioAPI): string {
  const prose = $.root().clone();
  prose.find('head, style, script').remove();
  return prose.html() ?? '';
}

export function censusFromHtml(html: string): DocumentStructureCensus {
  const $ = cheerio.load(html);
  return {
    chars: html.length,
    words: countWords(proseMarkup($)),
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
}): Promise<DocumentStructureCensus | ZipStructureCensus | null> {
  const { originalname, buffer } = file;
  if (buffer == null) {
    return null;
  }
  try {
    if (/\.zip$/i.test(originalname)) {
      return censusZipEntries(buffer);
    }
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
