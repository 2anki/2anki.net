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
// forks, and one made on Windows a Thumbs.db; a Finder folder adds .DS_Store.
// They are metadata, not pages or images the user put in.
function isResourceForkEntry(name: string): boolean {
  return (
    name.startsWith('__MACOSX/') ||
    /(^|\/)(\._[^/]*|\.DS_Store|Thumbs\.db|desktop\.ini)$/i.test(name)
  );
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

// Word count over the parsed text nodes, so entities are already decoded and
// tags never count. head, style, script, noscript, template and svg are
// skipped so a Notion export's embedded CSS never reads as prose. A run of
// non-space characters is a word only when it holds a letter or digit, so a
// lone "&" or "<" is not one. Nothing is accumulated per character, and the
// scan stops after WORD_SCAN_MAX_CHARS: the reading path caps files at 5 MB,
// and the no-package log census has no cap, so a 100 MB upload must cost a
// bounded scan, never a per-character string or a multi-gigabyte heap.
const WORD_SCAN_MAX_CHARS = 5 * 1024 * 1024;
const WORDLESS_ELEMENTS = new Set([
  'head',
  'style',
  'script',
  'noscript',
  'template',
  'svg',
]);

interface CensusNode {
  type: string;
  name?: string;
  data?: string;
  children?: CensusNode[];
}

function isWordSpace(code: number): boolean {
  return (
    code <= 32 ||
    code === 0x85 ||
    code === 0xa0 ||
    code === 0x1680 ||
    (code >= 0x2000 && code <= 0x200a) ||
    code === 0x2028 ||
    code === 0x2029 ||
    code === 0x202f ||
    code === 0x205f ||
    code === 0x3000
  );
}

const WORD_CHARACTER = /[\p{L}\p{N}]/u;

// Han, kana and hangul prose carries no spaces, so each such character
// counts as a word of its own; "1 word" for a page of Japanese is worse
// than an approximate count.
function isCjkCharacter(code: number): boolean {
  return (
    (code >= 0x3040 && code <= 0x30ff) ||
    (code >= 0x3400 && code <= 0x4dbf) ||
    (code >= 0x4e00 && code <= 0x9fff) ||
    (code >= 0xac00 && code <= 0xd7af) ||
    (code >= 0xf900 && code <= 0xfaff)
  );
}

function countRuns(
  data: string,
  budget: number
): { words: number; scanned: number } {
  const limit = Math.min(data.length, budget);
  let words = 0;
  let inRun = false;
  let runIsWord = false;
  for (let i = 0; i < limit; i += 1) {
    const code = data.charCodeAt(i);
    if (isWordSpace(code)) {
      if (runIsWord) words += 1;
      inRun = false;
      runIsWord = false;
      continue;
    }
    if (isCjkCharacter(code)) {
      if (runIsWord) words += 1;
      words += 1;
      inRun = false;
      runIsWord = false;
      continue;
    }
    inRun = true;
    if (!runIsWord && WORD_CHARACTER.test(data[i])) {
      runIsWord = true;
    } else if (!runIsWord && code >= 0xd800 && code <= 0xdbff) {
      // An astral letter (CJK Extension B, math alphanumerics) spans two
      // code units; test the pair so the run still counts.
      runIsWord = WORD_CHARACTER.test(data.slice(i, i + 2));
    }
  }
  if (inRun && runIsWord) words += 1;
  return { words, scanned: limit };
}

function countWords(root: CensusNode): number {
  let words = 0;
  let budget = WORD_SCAN_MAX_CHARS;
  const stack: CensusNode[] = [root];
  while (stack.length > 0 && budget > 0) {
    const node = stack.pop() as CensusNode;
    if (node.type === 'text') {
      const run = countRuns(node.data ?? '', budget);
      words += run.words;
      budget -= run.scanned;
      continue;
    }
    if (WORDLESS_ELEMENTS.has(node.name ?? '')) {
      continue;
    }
    const children = node.children ?? [];
    for (let i = children.length - 1; i >= 0; i -= 1) {
      stack.push(children[i]);
    }
  }
  return words;
}

export function censusFromHtml(html: string): DocumentStructureCensus {
  const $ = cheerio.load(html);
  return {
    chars: html.length,
    words: countWords($.root()[0] as unknown as CensusNode),
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
