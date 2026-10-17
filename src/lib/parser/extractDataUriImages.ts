// Images saved inside an HTML file as base64 data URIs are the one thing that
// makes a page huge: a 42 MB export is almost all picture bytes wrapped in a
// few hundred KB of text. Left inline, each image rides through the cheerio
// tree, every card's HTML string, the card-cleaning passes and the exporter's
// JSON payload, so one upload holds four or five copies of every picture on
// the V8 heap and a paying user's page dies at the child's 1 GB cap. Pulling
// the bytes out to disk before the DOM is built leaves one copy, the uploaded
// file itself, instead of five; the cards then reference an ordinary media
// file the exporter already knows how to bundle.
//
// This is a hand-rolled scan rather than a regex because the input is a
// user-controlled file of up to 100 MB that runs inside a conversion-pool
// child: a lazy `<img[^>]*?` pattern went quadratic on a page full of `<img`
// with no `>` (17 s on 880 KB). The scan walks each tag's text once and
// never looks backwards, so every character is visited a bounded number of
// times and a crafted page costs the same as an honest one.
//
// Anything unusual stays inline and takes the DOM path, which decodes
// entities before reading the src: an unknown subtype, a payload holding an
// HTML entity (`&#10;` line wraps, `&#43;` for a plus), a payload that runs
// into markup, extra parameters before `;base64`, or more images than the
// caps below. Decoding an entity-wrapped payload raw would skip the `&#;`
// characters and keep the digits, which corrupts the picture silently.

const EXTENSION_BY_SUBTYPE: ReadonlyMap<string, string> = new Map([
  ['png', 'png'],
  ['jpeg', 'jpg'],
  ['jpg', 'jpg'],
  ['gif', 'gif'],
  ['webp', 'webp'],
  ['svg+xml', 'svg'],
  ['bmp', 'bmp'],
  ['avif', 'avif'],
]);

const IMG_OPEN = '<img';
const SRC_DATA_PREFIX = 'src=';
const MARKER = 'data:image/';
const BASE64_TAG = ';base64,';
const MAX_SUBTYPE_CHARS = 32;
export const MAX_EXTRACTED_IMAGES = 5000;
export const MAX_EXTRACTED_BYTES = 256 * 1024 * 1024;

export type WriteExtractedImage = (bytes: Buffer, extension: string) => string;

export interface ExtractedDataUriImages {
  html: string;
  count: number;
  bytes: number;
}

function isSpace(code: number): boolean {
  return code === 32 || (code >= 9 && code <= 13);
}

function isBase64Char(code: number): boolean {
  return (
    (code >= 65 && code <= 90) ||
    (code >= 97 && code <= 122) ||
    (code >= 48 && code <= 57) ||
    code === 43 ||
    code === 47 ||
    code === 61 ||
    isSpace(code)
  );
}

function isImgTagStart(html: string, at: number): boolean {
  const next = html.charCodeAt(at + IMG_OPEN.length);
  return (
    html.slice(at, at + IMG_OPEN.length).toLowerCase() === IMG_OPEN &&
    (isSpace(next) || next === 47)
  );
}

interface DataUriSrc {
  valueStart: number;
  payloadStart: number;
  payloadEnd: number;
  extension: string;
}

// `at` is the space before an attribute inside an <img> tag. Returns the
// bounds of a well-formed `src="data:image/<subtype>;base64,<payload>"` there,
// or null. The payload walk stops at the first non-base64 character, so a
// value that never closes or runs into markup is walked once and rejected.
function readDataUriSrc(html: string, at: number): DataUriSrc | null {
  const attrStart = at + 1;
  if (!html.startsWith(SRC_DATA_PREFIX, attrStart)) return null;
  const quote = html[attrStart + SRC_DATA_PREFIX.length];
  if (quote !== '"' && quote !== "'") return null;
  const valueStart = attrStart + SRC_DATA_PREFIX.length + 1;
  if (!html.startsWith(MARKER, valueStart)) return null;
  const subtypeStart = valueStart + MARKER.length;
  // Look for `;base64,` only inside a short window: an unbounded indexOf
  // would rescan the rest of the file for every `src="data:image/` on a
  // page that never says base64.
  const subtypeWindow = html.slice(
    subtypeStart,
    subtypeStart + MAX_SUBTYPE_CHARS + BASE64_TAG.length
  );
  const subtypeLength = subtypeWindow.indexOf(BASE64_TAG);
  if (subtypeLength < 0 || subtypeLength > MAX_SUBTYPE_CHARS) return null;
  const extension = EXTENSION_BY_SUBTYPE.get(
    subtypeWindow.slice(0, subtypeLength).toLowerCase()
  );
  if (!extension) return null;
  const payloadStart = subtypeStart + subtypeLength + BASE64_TAG.length;
  let payloadEnd = payloadStart;
  while (
    payloadEnd < html.length &&
    isBase64Char(html.charCodeAt(payloadEnd))
  ) {
    payloadEnd += 1;
  }
  if (payloadEnd === payloadStart || html[payloadEnd] !== quote) return null;
  return { valueStart, payloadStart, payloadEnd, extension };
}

export function extractDataUriImages(
  html: string,
  writeImage: WriteExtractedImage
): ExtractedDataUriImages {
  if (!html.includes(MARKER)) {
    return { html, count: 0, bytes: 0 };
  }
  const out: string[] = [];
  let copied = 0;
  let count = 0;
  let bytes = 0;
  let cursor = 0;
  while (count < MAX_EXTRACTED_IMAGES && bytes < MAX_EXTRACTED_BYTES) {
    const tagStart = html.indexOf(IMG_OPEN, cursor);
    if (tagStart < 0) break;
    cursor = tagStart + IMG_OPEN.length;
    if (!isImgTagStart(html, tagStart)) continue;

    // Walk this tag's attribute text once. The walk consumes everything up to
    // the closing `>`, so a `<img` that appears inside a broken tag is never
    // rescanned, and a tag that never closes costs one pass to the end.
    let i = cursor;
    while (i < html.length && html[i] !== '>') {
      if (!isSpace(html.charCodeAt(i))) {
        i += 1;
        continue;
      }
      const src = readDataUriSrc(html, i);
      if (src == null) {
        i += 1;
        continue;
      }
      const image = Buffer.from(
        html.slice(src.payloadStart, src.payloadEnd).replace(/\s+/g, ''),
        'base64'
      );
      i = src.payloadEnd;
      if (image.length === 0) continue;
      const fileName = writeImage(image, src.extension);
      count += 1;
      bytes += image.length;
      out.push(html.slice(copied, src.valueStart), fileName);
      copied = src.payloadEnd;
      break;
    }
    cursor = Math.max(cursor, i);
  }
  if (count === 0) {
    return { html, count: 0, bytes: 0 };
  }
  out.push(html.slice(copied));
  return { html: out.join(''), count, bytes };
}
