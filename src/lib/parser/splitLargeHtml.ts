// cheerio holds a markup-dense page as roughly 30 bytes of heap per byte of
// HTML, so a 35 MB export outgrows the 1 GB conversion child before a single
// card is read. Parsing the page in slices keeps one slice's tree alive at a
// time. The heap limit stays where the runtime record put it.
export const SPLIT_HTML_ABOVE_BYTES = 12_000_000;
export const SPLIT_HTML_CHUNK_BYTES = 6_000_000;

// A stray closing tag at the top ends the container early; the rest of the
// page would then be repeated in every slice.
const MAX_SUFFIX_BYTES = 64_000;

const VOID_TAGS = new Set([
  'area',
  'base',
  'br',
  'col',
  'embed',
  'hr',
  'img',
  'input',
  'link',
  'meta',
  'source',
  'track',
  'wbr',
]);
const TAG_START = /^<\/?[a-zA-Z]/;
const RAW_TEXT_TAGS = new Set(['script', 'style']);
const PAGE_BODY =
  /<div\b[^>]*\bclass\s*=\s*["'][^"']*\bpage-body\b[^"']*["'][^>]*>/i;
const BODY = /<body\b[^>]*>/i;

interface Tag {
  name: string;
  closing: boolean;
  selfClosing: boolean;
  end: number;
}

function readTag(html: string, start: number): Tag | null {
  const nameMatch = /^<(\/?)([a-zA-Z][a-zA-Z0-9-]*)/.exec(
    html.slice(start, start + 40)
  );
  if (nameMatch == null) {
    return null;
  }
  let quote = '';
  for (let i = start + nameMatch[0].length; i < html.length; i++) {
    const ch = html[i];
    if (quote) {
      if (ch === quote) {
        quote = '';
      }
    } else if (ch === '"' || ch === "'") {
      quote = ch;
    } else if (ch === '>') {
      return {
        name: nameMatch[2].toLowerCase(),
        closing: nameMatch[1] === '/',
        selfClosing: html[i - 1] === '/',
        end: i + 1,
      };
    }
  }
  return null;
}

interface ContainerScan {
  boundaries: number[];
  contentEnd: number;
}

function scanTopLevelElements(
  html: string,
  contentStart: number
): ContainerScan | null {
  const boundaries: number[] = [];
  let depth = 0;
  let cursor = contentStart;
  while (cursor < html.length) {
    const lt = html.indexOf('<', cursor);
    if (lt === -1) {
      return null;
    }
    if (html.startsWith('<!--', lt)) {
      const close = html.indexOf('-->', lt + 4);
      if (close === -1) {
        return null;
      }
      cursor = close + 3;
      continue;
    }
    if (!TAG_START.test(html.slice(lt, lt + 3))) {
      cursor = lt + 1;
      continue;
    }
    const tag = readTag(html, lt);
    if (tag == null) {
      return null;
    }
    cursor = tag.end;
    if (tag.closing) {
      if (depth === 0) {
        return { boundaries, contentEnd: lt };
      }
      depth--;
      if (depth === 0) {
        boundaries.push(tag.end);
      }
    } else if (VOID_TAGS.has(tag.name) || tag.selfClosing) {
      if (depth === 0) {
        boundaries.push(tag.end);
      }
    } else {
      depth++;
      if (RAW_TEXT_TAGS.has(tag.name)) {
        const closeTag = new RegExp(`</${tag.name}`, 'gi');
        closeTag.lastIndex = cursor;
        const close = closeTag.exec(html);
        if (close == null) {
          return null;
        }
        cursor = close.index;
      }
    }
  }
  return null;
}

function findContainerStart(html: string): number | null {
  const container = PAGE_BODY.exec(html) ?? BODY.exec(html);
  return container == null ? null : container.index + container[0].length;
}

export function splitLargeHtml(
  html: string,
  options: { aboveBytes?: number; chunkBytes?: number } = {}
): string[] | null {
  const aboveBytes = options.aboveBytes ?? SPLIT_HTML_ABOVE_BYTES;
  const chunkBytes = options.chunkBytes ?? SPLIT_HTML_CHUNK_BYTES;
  if (html.length <= aboveBytes) {
    return null;
  }
  const contentStart = findContainerStart(html);
  if (contentStart == null) {
    return null;
  }
  const scan = scanTopLevelElements(html, contentStart);
  if (scan == null) {
    return null;
  }
  const prefix = html.slice(0, contentStart);
  const suffix = html.slice(scan.contentEnd);
  if (suffix.length > MAX_SUFFIX_BYTES) {
    return null;
  }
  const parts: string[] = [];
  let partStart = contentStart;
  for (const boundary of scan.boundaries) {
    if (boundary - partStart >= chunkBytes) {
      parts.push(html.slice(partStart, boundary));
      partStart = boundary;
    }
  }
  if (scan.contentEnd > partStart) {
    parts.push(html.slice(partStart, scan.contentEnd));
  }
  if (parts.length < 2) {
    return null;
  }
  return parts.map((part) => `${prefix}${part}${suffix}`);
}
