import * as cheerio from 'cheerio';
import { unzipSync } from 'fflate';

import { convertDocxToHTML } from './convertDocxToHTML';
import { isZipContentFileSupported } from '../../../usecases/uploads/isZipContentFileSupported';

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
  truncated: boolean;
  entries: ZipEntryCensus[];
}

const ZIP_CENSUS_MAX_ENTRIES = 50;
const ZIP_CENSUS_MAX_NAME = 120;

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
      truncated: false,
      entries: [],
    };
  }

  const nested = all.filter((e) => /\.zip$/i.test(e.name));
  const flat = all.filter((e) => !/\.zip$/i.test(e.name));
  const entries = all.slice(0, ZIP_CENSUS_MAX_ENTRIES).map((e) => ({
    name: e.name.slice(0, ZIP_CENSUS_MAX_NAME),
    size: e.size,
    supported: Boolean(isZipContentFileSupported(e.name)),
  }));

  return {
    kind: 'zip',
    entryCount: all.length,
    nestedZipCount: nested.length,
    supportedCount: flat.filter((e) => isZipContentFileSupported(e.name))
      .length,
    unsupportedCount: flat.filter((e) => !isZipContentFileSupported(e.name))
      .length,
    truncated: all.length > ZIP_CENSUS_MAX_ENTRIES,
    entries,
  };
}

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
